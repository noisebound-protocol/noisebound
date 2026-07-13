/**
 * octra-rpc.ts — Ghost execution layer RPC client for Octra mainnet.
 *
 * Wraps Octra's JSON-RPC 2.0 transport with graceful fallback to mock mode
 * when the mainnet node is unreachable. Every entry point clearly logs which
 * mode it is operating in so callers can reason about their environment.
 *
 * Transport: POST /rpc, Content-Type: application/json
 * Format:    { "jsonrpc": "2.0", "id": 1, "method": METHOD, "params": [...] }
 * Params are positional arrays — order matters exactly.
 *
 * ENDPOINT POLICY:
 *   Primary:  https://octra.network/rpc
 *   Fallback: https://rpc.octra.org
 *   If both are unreachable the client drops to local mock mode and logs clearly.
 *
 * KNOWN RPC METHOD GROUPS (discovered from node_status in real mode):
 *   node:         node_status, node_version, node_stats
 *   accounts:     octra_balance(address), octra_nonce(address), octra_publicKey(address)
 *   transactions: octra_submit(tx_json), octra_transaction(hash)
 *   circles:      op_type "deploy_circle" inside octra_submit
 *   FHE and encryption: method names unconfirmed — verify via node_status discovery
 *     ghostFheKeygen()  → WIRE: RPC name TBD (assumed fhe_keygen, unconfirmed)
 *     ghostFheEncrypt() → WIRE: RPC name TBD (assumed fhe_encrypt, unconfirmed)
 *     ghostFheDecrypt() → WIRE: RPC name TBD (assumed fhe_decrypt, unconfirmed)
 *   AML primitives in contract execution (confirmed AppliedML syntax):
 *     fhe_load_pk(pk_addr)        — load public key from on-chain address
 *     fhe_deser(ct)               — deserialize ciphertext string
 *     fhe_scale(pk, ct, scalar)   — multiply ciphertext by plaintext integer scalar
 *     fhe_add(pk, ct_a, ct_b)     — homomorphic addition of two ciphertexts
 *     fhe_add_const(pk, ct, int)  — add plaintext integer constant to ciphertext
 *     fhe_sub(pk, ct_a, ct_b)     — homomorphic subtraction
 *     fhe_ser(ct)                 — serialize ciphertext to string
 *     fhe_verify_zero(pk, ct, proof) — verify ciphertext decrypts to zero
 *   programs:     vm_contract(address)
 *   compilation:  compile (AppliedML source → bytecode)
 */

import axios from 'axios';
import { createPrivateKey, createPublicKey, sign as cryptoSign } from 'crypto';

// ─── Shared HTTP client ───────────────────────────────────────────────────────

const _http = axios.create({
  headers: {
    'Content-Type': 'application/json',
    'User-Agent': 'Veil-Ghost/1.0',
  },
});

// ─── Endpoints ────────────────────────────────────────────────────────────────

export const GHOST_RPC_PRIMARY = 'https://octra.network/rpc';
export const GHOST_RPC_FALLBACK = 'https://rpc.octra.org';
/** Octra devnet endpoint — opt-in only via GHOST_OCTRA_DEVNET=1 env var. Never the default. */
export const GHOST_RPC_DEVNET = 'https://devnet.octra.com/rpc';
const GHOST_RPC_TIMEOUT_MS = 8_000;

// ─── Mode state (module-level singleton) ──────────────────────────────────────

type ProbeState = 'pending' | 'real' | 'mock';

let _probeState: ProbeState = 'pending';
let _activeEndpoint: string = GHOST_RPC_PRIMARY;
let _probePromise: Promise<RpcMode> | null = null;

export type RpcMode = 'real' | 'mock';

/** Returns the current RPC mode ('real' or 'mock'). Pending becomes 'mock'. */
export function getRpcMode(): RpcMode {
  return _probeState === 'real' ? 'real' : 'mock';
}

/** Returns the endpoint that responded, or the primary if in mock mode. */
export function getActiveEndpoint(): string {
  return _activeEndpoint;
}

// ─── Node status types ────────────────────────────────────────────────────────

export interface GhostNodeStatus {
  version?: string;
  chainId?: string;
  blockHeight?: number;
  peers?: number;
  /** Available RPC method names reported by the node */
  methods?: string[];
  [key: string]: unknown;
}

// ─── Circle deploy payload (canonical from Octra docs) ────────────────────────

export const GHOST_CIRCLE_DEPLOY_PAYLOAD = {
  runtime: 'octb',
  privacy_class: 'sealed',
  browser_mode: 'native_sealed',
  resource_mode: 'sealed_read',
  code_b64: null as null,
  policy_hash: null as null,
  members_root: null as null,
  export_policy: null as null,
  limits: {
    max_stable_bytes: '33554432',
    max_assets_bytes: '33554432',
    max_inline_value: '65536',
    max_wasm_bytes: '33554432',
  },
} as const;

// ─── Circle ID derivation (deterministic, from Octra docs) ───────────────────

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function toBase58(bytes: Uint8Array): string {
  let num = 0n;
  for (const b of bytes) {
    num = num * 256n + BigInt(b);
  }
  let result = '';
  while (num > 0n) {
    result = BASE58_ALPHABET[Number(num % 58n)] + result;
    num = num / 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    result = '1' + result;
  }
  return result;
}

/**
 * Tagged SHA-256 hash mirroring Octra's h256(tag, ...args) convention.
 * All string args are UTF-8 encoded; numbers are little-endian uint64.
 */
async function h256(tag: string, ...args: (string | Uint8Array | number)[]): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [enc.encode(tag)];
  for (const a of args) {
    if (typeof a === 'string') {
      parts.push(enc.encode(a));
    } else if (typeof a === 'number') {
      const b = new Uint8Array(8);
      new DataView(b.buffer).setBigUint64(0, BigInt(a), true);
      parts.push(b);
    } else {
      parts.push(a);
    }
  }
  const total = parts.reduce((s, p) => s + p.length, 0);
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    combined.set(p, offset);
    offset += p.length;
  }
  const hashBuf = await crypto.subtle.digest('SHA-256', combined);
  return new Uint8Array(hashBuf);
}

/**
 * Derives the deterministic GhostCircle ID from the deploy payload,
 * deployer address, and nonce — mirrors Octra's circle_id derivation spec:
 *
 *   payload_hash = h256("octra:circle_deploy_payload:v1", json(payload))
 *   seed         = h256("octra:circle_deploy_id:v1", deployer_address, nonce, payload_hash)
 *   circle_id    = "oct" + base58(seed)[0:44]
 */
export async function deriveGhostCircleId(
  payload: object,
  deployerAddress: string,
  nonce: number,
): Promise<string> {
  const payloadJson = JSON.stringify(payload);
  const payloadHash = await h256('octra:circle_deploy_payload:v1', payloadJson);
  const seed = await h256('octra:circle_deploy_id:v1', deployerAddress, nonce, payloadHash);
  return 'oct' + toBase58(seed).slice(0, 44);
}

// ─── Core RPC transport ───────────────────────────────────────────────────────

let _rpcId = 1;

/**
 * Sends a single JSON-RPC 2.0 request to the active Octra node.
 *
 * On first call, automatically probes the primary and fallback endpoints.
 * Switches to mock mode if both are unreachable and returns null.
 * Subsequent calls skip the probe (cached result).
 */
export async function rpc(method: string, params: unknown[]): Promise<unknown> {
  await ensureProbed();

  if (_probeState !== 'real') {
    console.debug(`[ghost-rpc] mock mode — skipping ${method}`);
    return null;
  }

  const id = _rpcId++;
  try {
    const res = await _http.post<{ result?: unknown; error?: { code: number; message: string } }>(
      _activeEndpoint,
      { jsonrpc: '2.0', id, method, params },
      { timeout: GHOST_RPC_TIMEOUT_MS },
    );
    if (res.data.error) {
      throw new GhostRpcError(
        `Octra RPC error ${res.data.error.code}: ${res.data.error.message}`,
        method,
        res.data.error.code,
      );
    }
    return res.data.result ?? null;
  } catch (err) {
    if (err instanceof GhostRpcError) throw err;
    throw new GhostRpcError(`Octra RPC call ${method} failed: ${String(err)}`, method, -1);
  }
}

// ─── Probe ────────────────────────────────────────────────────────────────────

/**
 * Probes the primary and fallback Octra nodes, sets the module-level mode,
 * and returns it. Idempotent — subsequent calls return the cached result.
 */
export async function probeNode(): Promise<RpcMode> {
  if (_probeState !== 'pending') {
    return _probeState === 'real' ? 'real' : 'mock';
  }
  if (_probePromise) return _probePromise;
  _probePromise = _runProbe();
  return _probePromise;
}

async function ensureProbed(): Promise<void> {
  if (_probeState !== 'pending') return;
  await probeNode();
}

async function _tryEndpoint(url: string): Promise<boolean> {
  try {
    const res = await _http.post<{ result?: unknown }>(
      url,
      { jsonrpc: '2.0', id: 0, method: 'node_status', params: [] },
      { timeout: GHOST_RPC_TIMEOUT_MS },
    );
    return res.status === 200;
  } catch {
    return false;
  }
}

async function _runProbe(): Promise<RpcMode> {
  // Devnet opt-in: set GHOST_OCTRA_DEVNET=1 to target devnet instead of mainnet.
  // GHOST_OCTRA_DEVNET_URL overrides the default devnet URL.
  // This is an explicit safety gate — devnet mode NEVER activates by default.
  if (process.env['GHOST_OCTRA_DEVNET'] === '1') {
    const devnetUrl = process.env['GHOST_OCTRA_DEVNET_URL'] ?? GHOST_RPC_DEVNET;
    console.info(`[ghost-rpc] DEVNET MODE — probing ${devnetUrl}…`);
    if (await _tryEndpoint(devnetUrl)) {
      _activeEndpoint = devnetUrl;
      _probeState = 'real';
      console.info(`[ghost-rpc] real mode — devnet node ${devnetUrl}`);
      return 'real';
    }
    _probeState = 'mock';
    console.info(`[ghost-rpc] mock mode — devnet node unreachable: ${devnetUrl}`);
    return 'mock';
  }

  console.info('[ghost-rpc] probing Octra mainnet node…');

  if (await _tryEndpoint(GHOST_RPC_PRIMARY)) {
    _activeEndpoint = GHOST_RPC_PRIMARY;
    _probeState = 'real';
    console.info(`[ghost-rpc] real mode — using primary node ${GHOST_RPC_PRIMARY}`);
    return 'real';
  }

  if (await _tryEndpoint(GHOST_RPC_FALLBACK)) {
    _activeEndpoint = GHOST_RPC_FALLBACK;
    _probeState = 'real';
    console.info(`[ghost-rpc] real mode — primary unreachable, using fallback ${GHOST_RPC_FALLBACK}`);
    return 'real';
  }

  _probeState = 'mock';
  console.info(
    '[ghost-rpc] mock mode — both Octra nodes unreachable. ' +
      `Tried: ${GHOST_RPC_PRIMARY}, ${GHOST_RPC_FALLBACK}. ` +
      'Ghost inference will use local mock kernel.',
  );
  return 'mock';
}

/** Resets probe state — used by tests to force re-probe. */
export function _resetProbeState(): void {
  _probeState = 'pending';
  _probePromise = null;
  _activeEndpoint = GHOST_RPC_PRIMARY;
}

// ─── Named RPC helpers ────────────────────────────────────────────────────────

/**
 * Fetches the node status and the set of available RPC methods.
 * Returns null in mock mode.
 *
 * WIRE: node_status → result shape includes available_methods[]
 */
export async function ghostNodeStatus(): Promise<GhostNodeStatus | null> {
  const result = await rpc('node_status', []);
  if (result == null) return null;
  return result as GhostNodeStatus;
}

/**
 * Returns the on-chain nonce for a GhostCircle deployer address.
 * Returns 0 in mock mode.
 *
 * WIRE: octra_nonce(address) → number
 */
export async function ghostNonce(address: string): Promise<number> {
  const result = await rpc('octra_nonce', [address]);
  if (result == null) return 0;
  // Node returns { address, nonce } — extract the nonce field
  if (typeof result === 'object' && result !== null && 'nonce' in result) {
    return Number((result as { nonce: unknown }).nonce);
  }
  return typeof result === 'number' ? result : Number(result);
}

/**
 * Returns the OCT balance for an address in μOCT (1 OCT = 1_000_000 μOCT).
 * Returns 0n in mock mode.
 *
 * WIRE: octra_balance(address) → string|number in OCT
 */
export async function ghostBalance(address: string): Promise<bigint> {
  const result = await rpc('octra_balance', [address]);
  if (result == null) return 0n;
  // Node returns { address, balance, balance_raw, nonce, ... } — use balance_raw (μOCT) directly
  if (typeof result === 'object' && result !== null) {
    const res = result as { balance_raw?: unknown; balance?: unknown };
    if (res.balance_raw != null) return BigInt(String(res.balance_raw));
    if (res.balance != null) {
      return BigInt(Math.round(parseFloat(String(res.balance)) * 1_000_000));
    }
  }
  const octFloat = typeof result === 'string' ? parseFloat(result) : Number(result);
  return BigInt(Math.round(octFloat * 1_000_000));
}

// Ed25519 PKCS#8 v2 DER prefix for a 32-byte seed (RFC 8410)
const _ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
// Ed25519 SPKI DER prefix (12 bytes) before the 32-byte public key
const _ED25519_SPKI_PUB_OFFSET = 12;

/**
 * Signs a transaction body with Ed25519 per Octra's wire format.
 *
 * Mirrors octra_pre_client signing: compact JSON of all tx fields (no spaces),
 * signed as UTF-8 bytes. Adds `signature` (base64, 64 B) and `public_key`
 * (base64, 32 B) to the returned object.
 *
 * @param txBody  - Transaction fields WITHOUT signature/public_key.
 * @param privKeyHex - 32-byte Ed25519 seed in hex. NEVER log this value.
 */
export function signOctraTx(
  txBody: Record<string, unknown>,
  privKeyHex: string,
): Record<string, unknown> {
  const seed = Buffer.from(privKeyHex, 'hex');
  if (seed.length !== 32) throw new Error('GHOST_OCTRA_PRIVATE_KEY_HEX must be 32 bytes (64 hex chars)');

  const pkcs8 = Buffer.concat([_ED25519_PKCS8_PREFIX, seed]);
  const privKey = createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' });
  const pubSpki = createPublicKey(privKey).export({ type: 'spki', format: 'der' }) as Buffer;
  const rawPub = pubSpki.slice(_ED25519_SPKI_PUB_OFFSET);

  const msgBytes = Buffer.from(JSON.stringify(txBody), 'utf8');
  const sig = cryptoSign(null, msgBytes, privKey);

  return {
    ...txBody,
    signature: sig.toString('base64'),
    public_key: rawPub.toString('base64'),
  };
}

/**
 * Submits a signed transaction to the Octra network.
 * Returns the tx hash, or a mock hash prefixed with "0xmock" in mock mode.
 *
 * WIRE: octra_submit(tx_json) → { tx_hash: string }
 */
export async function ghostSubmitTx(txJson: Record<string, unknown>): Promise<string> {
  const result = await rpc('octra_submit', [txJson]);
  if (result == null) {
    // Mock tx hash: deterministic from the payload for reproducibility
    const preview = JSON.stringify(txJson).slice(0, 32);
    return '0xmock' + Buffer.from(preview).toString('hex').slice(0, 58);
  }
  const res = result as { tx_hash?: string };
  if (!res.tx_hash) throw new GhostRpcError('octra_submit: no tx_hash in response', 'octra_submit', -2);
  return res.tx_hash;
}

/**
 * Polls the status of a submitted transaction.
 * Returns null in mock mode or if the tx is not yet found.
 *
 * WIRE: octra_transaction(hash) → { status, result, ... }
 */
export async function ghostPollTx(hash: string): Promise<Record<string, unknown> | null> {
  const result = await rpc('octra_transaction', [hash]);
  if (result == null) return null;
  return result as Record<string, unknown>;
}

/**
 * Submits an AppliedML source string to the Octra compile RPC.
 * Returns base64-encoded bytecode, or the source encoded as base64 in mock mode.
 *
 * WIRE: compile(source) → { code_b64: string }
 *
 * NOTE: The exact method name for the compilation RPC is TBD — "compile" is
 * the likely name based on Octra docs but may differ per node_status.
 */
export async function ghostCompile(source: string): Promise<string> {
  try {
    const result = await rpc('compile', [source]);
    if (result == null) {
      return Buffer.from(source).toString('base64');
    }
    const res = result as { code_b64?: string };
    if (!res.code_b64) throw new GhostRpcError('compile: no code_b64 in response', 'compile', -3);
    return res.code_b64;
  } catch (err) {
    // -32601 = method not found: compile RPC name is unconfirmed — fall back to mock.
    if (err instanceof GhostRpcError && err.code === -32601) {
      return Buffer.from(source).toString('base64');
    }
    throw err;
  }
}

/**
 * Submits a GhostCircle deploy transaction.
 * Returns { circleId, txHash } — both are real on-chain values in real mode.
 *
 * WIRE: octra_submit with confirmed Octra wire format:
 *   - signFields field order: { from, to_, amount, nonce, ou, timestamp, op_type }
 *   - op_type: 'deploy_circle' is INSIDE the signing blob
 *   - payload (circle resource budget) is appended OUTSIDE the signing blob
 *   - ou: "1" for deploy_circle (not "250000" — that belongs inside payload only)
 *   - to_: deployerAddress (not empty string)
 *   - timestamp: Date.now() / 1000 as a float (millisecond precision / 1000)
 *
 * Nonce: the node returns 0 for a fresh account but expects 1 for the first tx.
 * We send wireNonce = nonce + 1, mirroring cli.py's mk() which uses n + 1.
 */
export async function ghostDeployCircle(
  deployerAddress: string,
  nonce: number,
  payload: object = GHOST_CIRCLE_DEPLOY_PAYLOAD,
): Promise<{ circleId: string; txHash: string }> {
  // Octra node returns 0 for a fresh account; first tx must use nonce 1.
  const wireNonce = nonce + 1;
  const circleId = await deriveGhostCircleId(payload, deployerAddress, wireNonce);

  // Signing blob: confirmed field order — op_type is INSIDE, payload is OUTSIDE
  const signFields: Record<string, unknown> = {
    from: deployerAddress,
    to_: deployerAddress,
    amount: '0',
    nonce: wireNonce,
    ou: '1',
    timestamp: Date.now() / 1000,
    op_type: 'deploy_circle',
  };

  const privKeyHex = process.env['GHOST_OCTRA_PRIVATE_KEY_HEX'];
  const signedFields = privKeyHex ? signOctraTx(signFields, privKeyHex) : signFields;

  // Full wire tx: signed fields + payload (outside the signing blob)
  const txJson: Record<string, unknown> = {
    ...signedFields,
    payload,
  };

  const txHash = await ghostSubmitTx(txJson);
  return { circleId, txHash };
}

// ─── FHE RPC helpers (availability depends on node_status) ────────────────────

/**
 * Generates an FHE keypair on the Octra node.
 * Returns null in mock mode — callers must fall back to local mock key generation.
 *
 * WIRE: RPC method name unconfirmed — assumed 'fhe_keygen' based on Octra FHE group naming.
 *       Verify actual name via node_status before wiring to production.
 *       Expected response: { public_key_b64: string, key_id: string }
 */
export async function ghostFheKeygen(): Promise<{ publicKeyB64: string; keyId: string } | null> {
  try {
    const result = await rpc('fhe_keygen', []);
    if (result == null) return null;
    const res = result as { public_key_b64?: string; key_id?: string };
    if (!res.public_key_b64) return null;
    return { publicKeyB64: res.public_key_b64, keyId: res.key_id ?? '' };
  } catch {
    return null;
  }
}

/**
 * Encrypts data using the FHE public key held by the Octra node.
 * Returns null in mock mode — callers must fall back to local encryptPayload().
 *
 * WIRE: RPC method name unconfirmed — assumed 'fhe_encrypt'; verify via node_status.
 *       Expected response: { ciphertext_b64: string }
 *       In-contract equivalent: fhe_deser(ct) then fhe_scale / fhe_add operations.
 */
export async function ghostFheEncrypt(dataB64: string, keyId: string): Promise<string | null> {
  try {
    const result = await rpc('fhe_encrypt', [dataB64, keyId]);
    if (result == null) return null;
    const res = result as { ciphertext_b64?: string };
    return res.ciphertext_b64 ?? null;
  } catch {
    return null;
  }
}

/**
 * Decrypts an FHE ciphertext inside the sealed Circle (decryption key never leaves).
 * Returns null in mock mode — callers must fall back to local decryptPayload().
 *
 * WIRE: RPC method name unconfirmed — assumed 'fhe_decrypt'; verify via node_status.
 *       Expected response: { plaintext_b64: string }
 *       In-contract results arrive as fhe_ser() strings — deserialize with fhe_deser().
 */
export async function ghostFheDecrypt(ciphertextB64: string, keyId: string): Promise<string | null> {
  try {
    const result = await rpc('fhe_decrypt', [ciphertextB64, keyId]);
    if (result == null) return null;
    const res = result as { plaintext_b64?: string };
    return res.plaintext_b64 ?? null;
  } catch {
    return null;
  }
}

// ─── Error type ───────────────────────────────────────────────────────────────

export class GhostRpcError extends Error {
  constructor(
    message: string,
    public readonly method: string,
    public readonly code: number,
  ) {
    super(message);
    this.name = 'GhostRpcError';
  }
}
