/**
 * CircleSession — lifecycle manager for a sealed GhostCircle used for
 * private FHE inference on the Octra network.
 *
 * Session lifecycle:
 *   1. new CircleSession(config)           — configure
 *   2. await session.create()              — deploy GhostCircle, load FHE public key
 *   3. encrypted = await session.encryptQuery(prompt, context)
 *   4. result    = await session.private_predict(encrypted)
 *   5. decoded   = await session.decryptResult(result)
 *   6. await session.teardown()            — destroy or reuse GhostCircle
 *
 * Setting reuse: true in SessionConfig keeps the GhostCircle alive across
 * multiple ghost_predict calls; teardown() only clears the active flag.
 *
 * RPC WIRING:
 *   create()          — calls octra_nonce to get deployer nonce, derives circle_id
 *                       deterministically, submits deploy_circle via octra_submit.
 *                       Falls back to local mock if Octra nodes are unreachable.
 *   private_predict() — in real mode: submits ghost_predict call to the on-chain Circle
 *                       and polls octra_transaction for the encrypted result.
 *                       Falls back to local mock inference kernel when unreachable.
 *                       Circle execution via program.call is not yet available via
 *                       JSON-RPC (browser-only today); mock path stays active.
 *   teardown()        — marks session closed, optionally preserves GhostCircle for reuse.
 */

import { sha256 } from '@noble/hashes/sha256';
import { Circle, deployCircle } from './circle.js';
import { fhe_load_pk, encryptPayload, decryptPayload } from './fhe.js';
import {
  probeNode,
  getRpcMode,
  ghostNonce,
  ghostDeployCircle,
  GHOST_CIRCLE_DEPLOY_PAYLOAD,
} from './octra-rpc.js';
import type {
  SessionConfig,
  FHEPublicKey,
  DeFiContext,
  InferenceResult,
  ParsedIntent,
  DeFiAction,
  CircleConfig,
} from './types.js';

const GHOST_MODEL_VERSION = 'veil-lm-fhe-0.1.0';

// Minimal AML program used for the local-mock Circle (matches real Circle syntax)
const GHOST_CIRCLE_PROGRAM = [
  'contract GhostInference {',
  '  state { owner: address, num_features: int, bias: int, total_queries: int }',
  '  constructor() {',
  '    self.owner = origin',
  '    self.num_features = 0',
  '    self.bias = 0',
  '    self.total_queries = 0',
  '  }',
  '  public view fn ghost_predict(pk_addr: string, ct0: string, ct1: string): string {',
  '    self.total_queries += 1',
  '    return ct0',
  '  }',
  '  public view fn get_query_count(): int { return self.total_queries }',
  '}',
].join('\n');

export class CircleSessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CircleSessionError';
  }
}

export class CircleSession {
  private _circle?: Circle;
  private _fhePk?: FHEPublicKey;
  private _active: boolean = false;
  /** On-chain circle_id when deployed via real RPC ('oct...'), undefined in mock mode */
  private _ghostCircleId?: string;

  constructor(private readonly config: SessionConfig) {}

  /**
   * Deploys a GhostCircle and loads the FHE public key.
   *
   * Real RPC path (Octra node reachable):
   *   1. Calls octra_nonce(deployerAddress) to get the current account nonce.
   *   2. Derives the deterministic ghost circle_id from the payload + nonce.
   *   3. Submits deploy_circle via octra_submit and captures the tx hash.
   *   4. Wraps the on-chain circle in a Circle object for local tracking.
   *
   * Mock path (Octra nodes unreachable):
   *   Falls back to the existing deterministic mock deployCircle() with the
   *   same interface. FHE key loading uses the mock XOR-keystream path in
   *   both modes since the Octra FHE SDK is not yet available (see fhe.ts).
   *
   * Idempotent: calling create() on an already-active session is a no-op.
   */
  async create(): Promise<void> {
    if (this._active) return;

    await probeNode();
    const mode = getRpcMode();

    if (mode === 'real') {
      try {
        const nonce = await ghostNonce(this.config.keypair.address);
        const { circleId, txHash } = await ghostDeployCircle(
          this.config.keypair.address,
          nonce,
          GHOST_CIRCLE_DEPLOY_PAYLOAD,
        );
        this._ghostCircleId = circleId;
        this._circle = new Circle(
          circleId,
          this.config.name ?? `ghost-${circleId.slice(3, 11)}`,
          txHash,
          { query_count: 0, model_version: GHOST_MODEL_VERSION },
        );
        console.info(
          `[ghost-session] GhostCircle deployed on-chain — circle_id=${circleId} tx=${txHash}`,
        );
      } catch (err) {
        // RPC call succeeded at probe time but failed mid-deploy — fall back to mock
        console.warn(
          `[ghost-session] on-chain deploy failed (${String(err)}), falling back to mock`,
        );
        this._circle = await this._mockDeploy();
      }
    } else {
      this._circle = await this._mockDeploy();
    }

    const pkBytes =
      this.config.fhePkBytes ?? generateMockFhePk(this.config.keypair.publicKey.dsa);
    this._fhePk = fhe_load_pk(pkBytes);
    this._active = true;
  }

  /**
   * Runs sealed FHE inference inside the GhostCircle.
   *
   * The encryptedQuery enters the sealed environment; the Circle kernel
   * processes it homomorphically and returns encrypted result bytes. No node
   * outside the GhostCircle ever sees the plaintext query or result.
   *
   * Real RPC path:
   *   Submits ghost_predict to the on-chain Circle via octra_submit with
   *   op_type="circle_call" and polls octra_transaction for the result.
   *   NOTE: program.call via JSON-RPC (vs browser window.OctraCircle) is not
   *   yet documented; the mock kernel runs until the RPC path is confirmed.
   *
   * WIRE (pending Octra Circle RPC): octra_submit({
   *   op_type: "circle_call",
   *   circle_id: this._ghostCircleId,
   *   method: "ghost_predict",
   *   params: [pk_addr, ct0, ct1],   // real signature: ghost_predict(pk_addr, ct0, ct1): string
   *   ou: "10000",
   * }) → poll octra_transaction(txHash) → fhe_ser() encoded result string
   */
  async private_predict(encryptedQuery: Uint8Array): Promise<Uint8Array> {
    if (!this._active || !this._circle || !this._fhePk) {
      throw new CircleSessionError(
        'CircleSession.private_predict: session not active — call create() first',
      );
    }

    // Register the call inside the Circle (increments query_count, returns txHash)
    await this._circle.execute('ghost_predict', {
      method: 'ghost_predict',
      params: [Array.from(encryptedQuery)],
    });

    // Mock FHE inference: decrypt query → run inference kernel → re-encrypt result
    // WIRE: replace with Circle program.call via octra_submit when RPC path is available
    const plaintext = decryptPayload(encryptedQuery, this._fhePk);
    const queryJson = new TextDecoder().decode(plaintext);
    const query = JSON.parse(queryJson) as { prompt: string; context: DeFiContext };
    const result = runGhostInferenceKernel(query.prompt, query.context);

    const resultBytes = new TextEncoder().encode(JSON.stringify(result));
    return encryptPayload(resultBytes, this._fhePk);
  }

  /**
   * Encrypts a natural language prompt + DeFi context for private_predict.
   * Requires the session to be active (call create() first).
   *
   * WIRE (real Circle path): serialize features as individual ct0, ct1 ciphertext strings
   *   using fhe_deser / fhe_scale on the client side, then pass to ghost_predict(pk_addr, ct0, ct1).
   *   In mock mode: packs prompt + context as JSON into encryptPayload() for round-trip testing.
   */
  async encryptQuery(prompt: string, context: DeFiContext): Promise<Uint8Array> {
    if (!this._fhePk) {
      throw new CircleSessionError(
        'CircleSession.encryptQuery: session not active — call create() first',
      );
    }
    const payload = new TextEncoder().encode(JSON.stringify({ prompt, context }));
    return encryptPayload(payload, this._fhePk);
  }

  /**
   * Decrypts result bytes from private_predict into a structured InferenceResult.
   * Requires the session to be active (call create() first).
   *
   * WIRE (real Circle path): the on-chain ghost_predict returns fhe_ser(result) — a serialized
   *   ciphertext string. Client-side decryption via fhe_decrypt RPC unwraps it to plaintext.
   *   In mock mode: reverses encryptPayload() XOR-keystream to recover the JSON result.
   */
  async decryptResult(bytes: Uint8Array): Promise<InferenceResult> {
    if (!this._fhePk) {
      throw new CircleSessionError(
        'CircleSession.decryptResult: session not active — call create() first',
      );
    }
    const plaintext = decryptPayload(bytes, this._fhePk);
    return JSON.parse(new TextDecoder().decode(plaintext)) as InferenceResult;
  }

  /**
   * Runs multi-feature FHE inference via ghost_predict_multi.
   *
   * The real on-chain path calls ghost_predict_multi(pk_addr, cts, n) where cts is a
   * comma-separated string of serialized ciphertexts (one per feature). The contract
   * uses parse_ints(cts, 3000) + mget() to iterate them, applying fhe_scale and fhe_add
   * per weight, then returns fhe_ser(result).
   *
   * In mock mode: falls back to the local inference kernel using the first feature only.
   *
   * WIRE: octra_submit({ op_type: "circle_call", method: "ghost_predict_multi",
   *         params: [pk_addr, cts_csv, n] }) → fhe_ser() encoded result string
   */
  async ghostPredictMulti(features: Uint8Array[]): Promise<Uint8Array> {
    if (!this._active || !this._circle || !this._fhePk) {
      throw new CircleSessionError(
        'CircleSession.ghostPredictMulti: session not active — call create() first',
      );
    }
    if (features.length === 0) {
      throw new CircleSessionError('CircleSession.ghostPredictMulti: features array must not be empty');
    }
    // Mock path: use first feature as the query payload
    const primary = features[0];
    return this.private_predict(primary);
  }

  /**
   * Tears down the GhostCircle session.
   *
   * If config.reuse is true, the Circle and FHE key are preserved; only the
   * active flag is cleared. Call create() again to re-activate.
   * If config.reuse is false (default), all session state is released.
   */
  async teardown(): Promise<void> {
    this._active = false;
    if (!this.config.reuse) {
      this._circle = undefined;
      this._fhePk = undefined;
      this._ghostCircleId = undefined;
    }
  }

  get isActive(): boolean { return this._active; }
  get circle(): Circle | undefined { return this._circle; }
  get fhePublicKey(): FHEPublicKey | undefined { return this._fhePk; }

  /** On-chain circle_id when deployed via real RPC; undefined in mock mode. */
  get ghostCircleId(): string | undefined { return this._ghostCircleId; }

  // ─── Internal helpers ──────────────────────────────────────────────────────

  private async _mockDeploy(): Promise<Circle> {
    const circleConfig: CircleConfig = {
      name: this.config.name ?? `ghost-session-${Date.now()}`,
      program: GHOST_CIRCLE_PROGRAM,
      programRuntime: 'octb',
      initialState: { model_version: GHOST_MODEL_VERSION, query_count: 0 },
      keypair: this.config.keypair,
    };
    return deployCircle(circleConfig);
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Derives a deterministic mock FHE public key from the DSA signing key.
 * In production this comes from the Octra FHE key registry.
 *
 * WIRE: replace with ghostFheKeygen() → OctraFHE key registry when FHE SDK ships.
 */
function generateMockFhePk(dsaPublicKey: Uint8Array): Uint8Array {
  const prefix = new TextEncoder().encode('veil-fhe-mock-pk:');
  const combined = new Uint8Array(prefix.length + dsaPublicKey.length);
  combined.set(prefix, 0);
  combined.set(dsaPublicKey, prefix.length);
  return sha256(combined);
}

// ─── Ghost inference kernel (mock) ────────────────────────────────────────────

/**
 * Minimal inline inference kernel for the Ghost FHE mock path.
 *
 * Kept independent from inference.ts to avoid a circular dependency.
 * Covers the same DeFi patterns as parseIntentMock().
 *
 * WIRE: this entire function is replaced by real CKKS-HFHE homomorphic
 * inference inside the sealed GhostCircle when the Ghost AI network goes live:
 *   ghost_predict(encrypted_query) → HFHE kernel → encrypted result
 */
function runGhostInferenceKernel(prompt: string, context: DeFiContext): InferenceResult {
  const text = prompt.toLowerCase().trim();
  let action: DeFiAction = 'unknown';
  let fromToken: string | undefined;
  let toToken: string | undefined;
  let amount: string | undefined;
  let protocol: string | undefined;

  const swapM =
    text.match(/swap\s+([\d.]+\s+)?(\w+)\s+(?:for|to)\s+(\w+)/i) ??
    text.match(/exchange\s+([\d.]+\s+)?(\w+)\s+(?:for|to)\s+(\w+)/i);
  if (swapM) {
    action = 'swap';
    fromToken = swapM[2].toUpperCase();
    toToken = swapM[3].toUpperCase();
    amount = swapM[1]?.trim();
  } else {
    const bridgeM = text.match(/bridge\s+([\d.]+\s+)?(\w+)\s+(?:to|from)\s+(\w+)/i);
    if (bridgeM) {
      action = 'bridge';
      fromToken = bridgeM[2].toUpperCase();
      toToken = bridgeM[3].toUpperCase();
      amount = bridgeM[1]?.trim();
    } else {
      const stakeM = text.match(/stake\s+([\d.]+\s+)?(\w+)/i);
      if (stakeM) {
        action = 'stake';
        fromToken = stakeM[2].toUpperCase();
        amount = stakeM[1]?.trim();
      } else {
        const borrowM = text.match(/borrow\s+([\d.]+\s+)?(\w+)/i);
        if (borrowM) {
          action = 'borrow';
          toToken = borrowM[2].toUpperCase();
          amount = borrowM[1]?.trim();
        } else {
          const lendM = text.match(/(?:lend|supply|deposit)\s+([\d.]+\s+)?(\w+)/i);
          if (lendM) {
            action = 'lend';
            fromToken = lendM[2].toUpperCase();
            amount = lendM[1]?.trim();
          }
        }
      }
    }
  }

  const KNOWN_PROTOCOLS = [
    'uniswap', 'aave', 'curve', 'compound', 'lido', 'stargate', 'hop', 'across',
  ];
  protocol = KNOWN_PROTOCOLS.find(p => text.includes(p));

  const urgency =
    /urgent|asap|immediately|now|fast/i.test(text)
      ? 'high'
      : /soon|quick/i.test(text)
        ? 'medium'
        : 'low';

  const intent: ParsedIntent = { action, fromToken, toToken, amount, protocol, urgency };

  const confidence =
    action === 'unknown'
      ? 0.2
      : 0.55 +
        (amount !== undefined ? 0.1 : 0) +
        (protocol !== undefined ? 0.2 : 0) +
        (fromToken !== undefined || toToken !== undefined ? 0.1 : 0);

  const usedProtocols = context.availableProtocols;

  return {
    intent,
    confidence,
    rawResponse: JSON.stringify({
      model: GHOST_MODEL_VERSION,
      parsed: intent,
      context_protocols: usedProtocols,
      note: 'Ghost FHE mock — replace with real Circle inference when Octra SDK ships',
    }),
    modelVersion: GHOST_MODEL_VERSION,
  };
}
