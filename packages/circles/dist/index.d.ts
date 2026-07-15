import { PQCKeypair } from '@noisebound/pqc-wallet';
export { PQCKeypair } from '@noisebound/pqc-wallet';

/** ZK proof of biometric authentication (@noisebound/key-derive's auth counterpart). */
interface AuthProof {
    proof: Uint8Array;
    publicInputs: string[];
}
interface NetworkInfo {
    /** RPC endpoint that was pinged */
    endpoint: string;
    /** Number of transactions currently staged in the mempool */
    stagedTransactions: number;
    reachable: boolean;
    latencyMs: number;
}
/**
 * Octra network transaction.
 *
 * Mirrors the native transaction format from octra-labs/octra_pre_client.
 * `amount` is in μOCT (micro-OCT): 1 OCT = 1_000_000 μOCT.
 *
 * NOTE: Octra's testnet currently validates Ed25519 signatures.
 * The pqcSignature fields carry Veil's ML-DSA-65 identity layer alongside
 * the transaction. Full Octra-native PQC signing requires Octra SDK support.
 * TODO: wire Ed25519 signing when OctraClient is used against raw testnet send.
 */
interface CircleTx {
    from: string;
    to: string;
    amount: string;
    nonce: number;
    ou: string;
    timestamp: number;
    message?: string;
}
interface CircleDeployConfig {
    privacyClass: 'sealed' | 'public';
    /** Resource unit budget for deployment. Octra testnet default: "250000" */
    ou: string;
    limits?: {
        maxStableBytes?: string;
        maxAssetsBytes?: string;
        maxInlineValue?: string;
        maxWasmBytes?: string;
    };
}
/**
 * Configuration for deploying a Circle.
 *
 * `program` is either AppliedML (.aml) source code or a base64-encoded
 * WASM binary (for wasm_v1 runtime). This mirrors Octra's circle.json format:
 *   https://github.com/octra-labs/circle_examples
 */
interface CircleConfig {
    name: string;
    program: string;
    programRuntime: 'octb' | 'wasm_v1';
    initialState?: Record<string, unknown>;
    keypair: PQCKeypair;
    deployConfig?: CircleDeployConfig;
}
/**
 * Inputs for a Circle method call.
 * Maps to Octra's window.OctraCircle.request('program.call', ...) format.
 */
interface CircleInputs {
    method: string;
    params: unknown[];
    /** μOCT to attach to the call (default "0") */
    amount?: string;
    /** Resource unit budget for execution (default "1000") */
    ou?: string;
}
interface CircleResult {
    success: boolean;
    value: unknown;
    txHash?: string;
    error?: string;
}
interface CircleState {
    address: string;
    fields: Record<string, unknown>;
    lastUpdated: number;
}
interface SpendingLimits {
    maxPerTx: bigint;
    maxPerDay: bigint;
    maxTotal: bigint;
}
interface AgentConfig {
    agentId: string;
    /** DeFi protocol IDs this agent may interact with (e.g. ["uniswap", "aave"]) */
    allowedProtocols: string[];
    spendingLimits: SpendingLimits;
    keypair: PQCKeypair;
    /**
     * Optional biometric proof authorizing this agent to operate.
     * Produced by @veil/auth VeilAuth.authenticate().
     */
    authProof?: AuthProof;
}
interface ExecutionStep {
    protocol: string;
    action: string;
    params: Record<string, unknown>;
    /** Estimated cost in μOCT */
    estimatedCost: bigint;
}
interface ExecutionPlan {
    steps: ExecutionStep[];
    /** Total estimated cost in μOCT */
    estimatedCost: bigint;
    protocols: string[];
    intent: ParsedIntent;
}
interface ExecutionResult {
    success: boolean;
    plan: ExecutionPlan;
    txHashes: string[];
    /** Actual cost in μOCT */
    actualCost: bigint;
    /** Unix epoch ms */
    timestamp: number;
    error?: string;
}
type DeFiAction = 'swap' | 'lend' | 'borrow' | 'stake' | 'bridge' | 'unknown';
interface ParsedIntent {
    action: DeFiAction;
    fromToken?: string;
    toToken?: string;
    amount?: string;
    protocol?: string;
    /** Tolerable slippage fraction (0–1) */
    slippageTolerance?: number;
    urgency: 'low' | 'medium' | 'high';
}
interface DeFiContext {
    availableProtocols: string[];
    /** Token symbol → human-readable amount string */
    userBalances: Record<string, string>;
    gasPrice?: string;
    chainId?: string;
}
interface InferenceResult {
    intent: ParsedIntent;
    /** Model confidence score 0–1 */
    confidence: number;
    rawResponse: string;
    modelVersion: string;
}
/**
 * FHE public key loaded via fhe_load_pk.
 *
 * Scheme: CKKS (Cheon-Kim-Kim-Song) — approximate homomorphic encryption
 * suited for ML inference on real-valued vectors.
 *
 * TODO: When Octra FHE SDK ships, replace the 'ckks-mock' literal with the
 * real scheme identifier returned by OctraFHE.loadPublicKey(pkBytes).
 */
interface FHEPublicKey {
    readonly bytes: Uint8Array;
    readonly algorithm: 'ckks-mock';
    /** CKKS scale factor (2^40 by default — 40-bit precision) */
    readonly scale: number;
    /** Hex fingerprint: first 16 hex chars of sha256(bytes) */
    readonly keyId: string;
}
/**
 * Scaled plaintext value produced by fhe_scale / fhe_add.
 *
 * In real CKKS-FHE: a ciphertext encrypting (scaled / scale) under the
 * public key. Homomorphic ops (add, mul) operate on ciphertext without
 * revealing the plaintext to any node.
 */
interface FHEScaled {
    readonly scaled: number;
    readonly scale: number;
    /** Mock ciphertext bytes (float64 LE encoding of the scaled value) */
    readonly ciphertext: Uint8Array;
}
/**
 * Configuration for a CircleSession.
 *
 * A CircleSession manages the lifecycle of one Octra Circle used for
 * sealed FHE inference: deploy → load pk → encrypt → private_predict → decrypt → teardown.
 */
interface SessionConfig {
    keypair: PQCKeypair;
    /** Circle name; defaults to a timestamp-based name if omitted */
    name?: string;
    /**
     * Keep the Circle alive across multiple private_predict calls.
     * Default: false — Circle is destroyed on teardown().
     */
    reuse?: boolean;
    /**
     * Pre-loaded FHE public key bytes.
     * If omitted, CircleSession derives a deterministic mock key from the keypair.
     */
    fhePkBytes?: Uint8Array;
}

/**
 * OctraClient — HTTP client for the Octra testnet RPC.
 *
 * Documented Octra REST API (source: octra-labs/octra_pre_client):
 *   GET  /balance/{address}  → { nonce, balance }  (balance in OCT)
 *   GET  /staging            → { staged_transactions: [...] }
 *   GET  /address/{address}  → { recent_transactions, has_public_key }
 *   GET  /tx/{hash}          → { parsed_tx: { from, to, amount, ... } }
 *   POST /send-tx            → { status: "accepted", tx_hash }
 *
 * Circle deployment and execution are NOT available via REST today.
 * Circles run in sealed browser environments accessed via the
 * window.OctraCircle.request() browser API, deployed through light-node CLI.
 * See circle.ts for the clean interface with honest mocks.
 */

declare const OCTRA_TESTNET_URL = "https://octra.network";
declare class OctraConnectionError extends Error {
    readonly endpoint: string;
    constructor(message: string, endpoint: string);
}
declare class OctraClient {
    readonly rpcUrl: string;
    readonly keypair: PQCKeypair;
    private readonly http;
    constructor(rpcUrl: string, keypair: PQCKeypair);
    /**
     * Pings the Octra testnet /staging endpoint and measures latency.
     *
     * Throws OctraConnectionError with a clear diagnostic message when the
     * network is unreachable — never returns a partially-valid NetworkInfo.
     */
    getNetworkInfo(): Promise<NetworkInfo>;
    /**
     * Returns the balance of an Octra address in μOCT.
     * (1 OCT = 1_000_000 μOCT, matching Octra's internal unit.)
     * Returns 0n for addresses not yet on-chain.
     */
    getBalance(address: string): Promise<bigint>;
    /**
     * Signs and sends a transaction to the Octra network.
     * Returns the transaction hash on acceptance.
     *
     * Signing: SHA3-256 of the canonical JSON → ML-DSA-65 signature.
     * The pqcSignature and pqcPublicKey fields carry Veil's identity layer.
     *
     * TODO: Octra testnet validates Ed25519 (NaCl) signatures for standard txs.
     * This method will work for Veil-aware nodes but currently fails on vanilla
     * Octra testnet. Wire in Ed25519 signing once Octra SDK matures or when
     * PQC signing support is added to Octra's protocol.
     */
    sendTransaction(tx: CircleTx): Promise<string>;
}

/**
 * Circle lifecycle — deploy, retrieve, and interact with Octra Circles.
 *
 * CURRENT STATUS (honest):
 *   Circle deployment requires Octra's `light-node` CLI with a compiled
 *   circle.json + program binary. There is no documented REST API for
 *   deploying Circles remotely today.
 *
 *   Circle execution uses the browser-native window.OctraCircle.request()
 *   API inside a running sealed Circle, not an external RPC call.
 *
 *   Both deployCircle() and Circle.execute() are therefore cleanly mocked
 *   with the correct interface. When Octra's SDK ships a Node.js deploy
 *   path, replace the TODO sections below.
 *
 * REFERENCE:
 *   circle.json format: https://github.com/octra-labs/circle_examples
 *   program.call / program.view API: aml_circle_counter/site/app.js
 */

declare class Circle {
    readonly address: string;
    readonly name: string;
    readonly deploymentTx: string;
    private _state;
    constructor(address: string, name: string, deploymentTx: string, initialState?: Record<string, unknown>);
    /**
     * Sends an encrypted instruction to the Circle for execution.
     *
     * Maps to Octra's program.call / program.view browser API:
     *   window.OctraCircle.request('program.call', { method, params, amount, ou })
     *   window.OctraCircle.request('program.view', { method, params })
     *
     * TODO: wire into Octra's sealed Circle execution environment when
     * a Node.js RPC path for program.call becomes available.
     */
    execute(instruction: string, inputs: CircleInputs): Promise<CircleResult>;
    /**
     * Returns the current state fields of this Circle.
     *
     * Maps to window.OctraCircle.request('program.view', { method: 'get_*', params: [] })
     *
     * TODO: wire into live Circle state query when Octra Node.js SDK ships.
     */
    getState(): Promise<CircleState>;
    /**
     * Returns true if this Circle's sealed execution environment is intact.
     *
     * TODO: wire into Octra's circle integrity attestation API.
     */
    isSealed(): Promise<boolean>;
}
/**
 * Deploys an AppliedML or WASM program as a sealed Circle on Octra.
 *
 * TODO: replace mock with real deployment when Octra ships a Node.js
 * deploy API. Today, deployment requires:
 *   1. Compile program: `octra build circle.json`
 *   2. Deploy via light-node: `octra deploy --circle circle.json`
 *   3. Get back the Circle address from the deploy receipt
 *
 * The circle.json format is documented at:
 *   https://github.com/octra-labs/circle_examples/blob/main/aml_circle_counter/circle.json
 */
declare function deployCircle(config: CircleConfig): Promise<Circle>;
/**
 * Retrieves a Circle handle by its on-chain address.
 *
 * TODO: query Octra's program.info endpoint for the live Circle descriptor:
 *   window.OctraCircle.request('program.info')
 * and reconstruct the Circle with its current state.
 */
declare function getCircle(address: string): Promise<Circle>;

/**
 * AgentCircle — Circle configured for private DeFi agent execution.
 *
 * Spending limits are enforced in TypeScript before any execution reaches
 * the Circle layer. This is real logic, not mocked.
 *
 * The VeilLM call and Circle submission are mocked with correct interfaces
 * until the distributed inference network and Octra Node.js SDK ship.
 */

declare class SpendingLimitError extends Error {
    constructor(message: string);
}
declare class ProtocolNotAllowedError extends Error {
    constructor(protocol: string, agentId: string);
}
declare class AgentCircle extends Circle {
    readonly agentConfig: AgentConfig;
    private readonly veilLM;
    private readonly history;
    private dailySpend;
    private totalSpend;
    private dailyWindowStart;
    constructor(circleAddress: string, circleName: string, deploymentTx: string, agentConfig: AgentConfig, 
    /**
     * Optional FHE session config. When provided, executeInstruction() routes
     * all VeilLM queries through private_predict inside a sealed CircleSession
     * so no instruction plaintext is visible to any external node.
     * Omit to use the local regex mock (useful for tests without a keypair).
     */
    sessionConfig?: SessionConfig);
    /**
     * Parses a natural language DeFi instruction into a structured ExecutionPlan.
     *
     * Uses VeilLM (mocked) for intent parsing, then validates the plan against
     * spending limits and allowed protocols before returning it.
     *
     * Throws SpendingLimitError or ProtocolNotAllowedError rather than
     * silently returning a plan that would fail on submitExecution.
     */
    executeInstruction(instruction: string): Promise<ExecutionPlan>;
    /**
     * Submits a validated ExecutionPlan for sealed execution inside the Circle.
     *
     * Enforces daily and lifetime spending limits before forwarding to the
     * Circle execution layer (mocked until Octra SDK matures).
     *
     * TODO: replace mock Circle execution with real Circle.execute() call
     * once Octra's program.call is accessible from Node.js.
     */
    submitExecution(plan: ExecutionPlan): Promise<ExecutionResult>;
    /** Returns the full execution history for this AgentCircle. */
    getExecutionHistory(): Promise<ExecutionResult[]>;
    private resetDailyWindowIfNeeded;
}
/**
 * Creates an AgentCircle — a Circle configured for DeFi agent execution.
 *
 * The biometric authProof in AgentConfig is verified structurally
 * (non-empty proof bytes) but not cryptographically here — the ZK
 * verification lives in @veil/auth and is expected to have been run
 * by the caller before constructing AgentConfig.
 */
declare function createAgentCircle(agentConfig: AgentConfig, sessionConfig?: SessionConfig): Promise<AgentCircle>;

/**
 * VeilLM inference client.
 *
 * CURRENT STATUS (honest):
 *   VeilLM is distributed LLM inference running inside Octra Circles —
 *   agent queries processed privately across nodes using FHE so no single
 *   node sees the query plaintext.
 *   The distributed inference network is not yet live.
 *
 *   This module implements the correct interface with:
 *     - A deterministic regex mock (no sessionConfig)
 *     - A FHE-routed path via CircleSession (sessionConfig provided)
 *
 *   Both paths return identical InferenceResult shapes so downstream code
 *   (AgentCircle, tests) works against either implementation today.
 *
 *   When VeilLM inference goes live, the sessionConfig path will already
 *   route through real Circle RPC — only the mock inside CircleSession
 *   needs to be replaced with an actual Octra program.call.
 */

declare class VeilLMClient {
    private readonly circleAddress?;
    private readonly sessionConfig?;
    constructor(circleAddress?: string | undefined, sessionConfig?: SessionConfig | undefined);
    /**
     * Sends a natural language prompt to VeilLM for inference.
     *
     * When sessionConfig is provided: routes through private_predict inside a
     * sealed CircleSession — the prompt is FHE-encrypted before entering the
     * Circle and the result is decrypted on return. No plaintext leaves the
     * encrypted boundary.
     *
     * When sessionConfig is absent: falls back to the local regex mock so
     * downstream code and tests work without a keypair or Octra connection.
     *
     * TODO (FHE path): when VeilLM inference is live, the CircleSession's
     * private_predict body is the only thing that changes — this method stays.
     */
    query(prompt: string, context: DeFiContext): Promise<InferenceResult>;
    /**
     * Parses a natural language DeFi instruction into a structured ParsedIntent.
     *
     * Mock implementation covers common DeFi patterns via regex.
     * Real implementation would route through a VeilLM Circle for private
     * LLM inference so no agent intent leaks to any single node.
     *
     * TODO: wire into VeilLM Circle when distributed inference is available.
     */
    parseIntent(instruction: string): Promise<ParsedIntent>;
    /**
     * Submits a pre-encrypted query to a sealed Circle for FHE inference.
     *
     * Creates a CircleSession internally using the client's sessionConfig.
     * Caller is responsible for encrypting the query (e.g. via CircleSession
     * directly) before passing it here.
     *
     * Throws if no sessionConfig was provided at construction.
     *
     * TODO: this method routes to real Octra program.call automatically once
     * CircleSession.private_predict is wired to the live Octra SDK.
     */
    private_predict(encryptedQuery: Uint8Array): Promise<Uint8Array>;
}

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

declare class CircleSessionError extends Error {
    constructor(message: string);
}
declare class CircleSession {
    private readonly config;
    private _circle?;
    private _fhePk?;
    private _active;
    /** On-chain circle_id when deployed via real RPC ('oct...'), undefined in mock mode */
    private _ghostCircleId?;
    constructor(config: SessionConfig);
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
    create(): Promise<void>;
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
    private_predict(encryptedQuery: Uint8Array): Promise<Uint8Array>;
    /**
     * Encrypts a natural language prompt + DeFi context for private_predict.
     * Requires the session to be active (call create() first).
     *
     * WIRE (real Circle path): serialize features as individual ct0, ct1 ciphertext strings
     *   using fhe_deser / fhe_scale on the client side, then pass to ghost_predict(pk_addr, ct0, ct1).
     *   In mock mode: packs prompt + context as JSON into encryptPayload() for round-trip testing.
     */
    encryptQuery(prompt: string, context: DeFiContext): Promise<Uint8Array>;
    /**
     * Decrypts result bytes from private_predict into a structured InferenceResult.
     * Requires the session to be active (call create() first).
     *
     * WIRE (real Circle path): the on-chain ghost_predict returns fhe_ser(result) — a serialized
     *   ciphertext string. Client-side decryption via fhe_decrypt RPC unwraps it to plaintext.
     *   In mock mode: reverses encryptPayload() XOR-keystream to recover the JSON result.
     */
    decryptResult(bytes: Uint8Array): Promise<InferenceResult>;
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
    ghostPredictMulti(features: Uint8Array[]): Promise<Uint8Array>;
    /**
     * Tears down the GhostCircle session.
     *
     * If config.reuse is true, the Circle and FHE key are preserved; only the
     * active flag is cleared. Call create() again to re-activate.
     * If config.reuse is false (default), all session state is released.
     */
    teardown(): Promise<void>;
    get isActive(): boolean;
    get circle(): Circle | undefined;
    get fhePublicKey(): FHEPublicKey | undefined;
    /** On-chain circle_id when deployed via real RPC; undefined in mock mode. */
    get ghostCircleId(): string | undefined;
    private _mockDeploy;
}

/**
 * FHE primitives for Octra GhostCircle inference.
 *
 * Implements the fhe_load_pk / fhe_scale / fhe_add interface that maps to
 * Octra's HFHE instruction set for sealed GhostCircle execution. No query
 * plaintext leaves the encrypted boundary — only ciphertext enters and exits.
 *
 * CURRENT STATUS (honest):
 *   Octra's CKKS-based HFHE layer is described in the whitepaper but the
 *   Node.js SDK is not yet available. These functions implement the correct
 *   calling convention and return types. The mock encryption uses an
 *   XOR-keystream (sha256 of pk bytes) so the round-trip is bit-perfect.
 *
 *   Real wiring points (confirmed AML primitives — Octra AppliedML syntax):
 *     fhe_load_pk(pk_addr)         — load public key from on-chain address string
 *     fhe_deser(ct)                — deserialize ciphertext string to cipher object
 *     fhe_scale(pk, ct, scalar)    — multiply ciphertext by plaintext integer scalar
 *     fhe_add(pk, ct_a, ct_b)      — homomorphic addition of two ciphertexts
 *     fhe_add_const(pk, ct, int)   — add plaintext integer constant to ciphertext
 *     fhe_sub(pk, ct_a, ct_b)      — homomorphic subtraction
 *     fhe_ser(ct)                  — serialize ciphertext back to string
 *     fhe_verify_zero(pk, ct, proof) — verify a ciphertext decrypts to zero
 *
 *   RPC wrappers (method names unconfirmed — verify via node_status):
 *     ghostFheKeygen()   → WIRE: RPC name TBD (assumed fhe_keygen)
 *     ghostFheEncrypt()  → WIRE: RPC name TBD (assumed fhe_encrypt)
 *     ghostFheDecrypt()  → WIRE: RPC name TBD (assumed fhe_decrypt)
 *   See octra-rpc.ts for async RPC wrappers.
 */

declare class FHEError extends Error {
    constructor(message: string);
}
/**
 * Loads an FHE public key from raw bytes.
 *
 * The key is used to encrypt queries before they enter a sealed Circle.
 * The Circle's private key (held inside the sealed environment and never
 * exposed) is the only thing that can decrypt the inference result.
 *
 * WIRE: fhe_load_pk(pk_addr: string) — load public key from address
 *       Replace body with OctraHFHE.loadPublicKey(pkBytes) when SDK ships.
 */
declare function fhe_load_pk(pkBytes: Uint8Array): FHEPublicKey;
/**
 * Scales a plaintext float for CKKS FHE encoding.
 *
 * In real CKKS: maps the float to a polynomial ring element at the given
 * scale factor. The resulting FHEScaled can be homomorphically added or
 * multiplied without decryption — the inference server operates on
 * ciphertexts only and never sees the underlying value.
 *
 * WIRE: fhe_scale(pk, ct, scalar: int) — multiply ct by plaintext scalar
 *       Replace body with OctraHFHE.scale(value, pk.scale) when SDK ships.
 */
declare function fhe_scale(value: number, scale: number): FHEScaled;
/**
 * Adds two FHE-scaled values homomorphically.
 *
 * Both operands must share the same scale. In CKKS this corresponds to
 * polynomial addition in the ciphertext ring — no decryption needed.
 * Used in the VeilLM inference path to aggregate token embeddings.
 *
 * WIRE: fhe_add(pk, ct_a, ct_b) — homomorphic addition
 *       Replace body with OctraHFHE.add(a, b) when SDK ships.
 */
declare function fhe_add(a: FHEScaled, b: FHEScaled): FHEScaled;
/**
 * Encrypts a plaintext payload for sealed Circle execution.
 *
 * Wire format: [4-byte LE payload length][8-byte FHE feature context][XOR-encrypted payload]
 *
 * The 8-byte FHE feature context is the ciphertext of (byteLength + tokenCount)
 * encoded via fhe_scale / fhe_add — this mirrors the real CKKS workflow where
 * prompt embeddings are accumulated as scaled homomorphic values before the
 * inference kernel runs.
 *
 * WIRE: fhe_deser(ct_string) — deserialize ciphertext; fhe_scale / fhe_add / fhe_ser for results
 *       Replace with OctraHFHE.encrypt(payload, pk) when SDK ships.
 *       In-contract flow: client serializes features as ct0/ct1 strings; contract calls fhe_deser().
 */
declare function encryptPayload(payload: Uint8Array, pk: FHEPublicKey): Uint8Array;
/**
 * Decrypts a ciphertext produced by encryptPayload using the same public key.
 *
 * In the real system this operation runs inside the sealed Circle using the
 * Circle's private key — the plaintext is never exposed outside the FHE
 * environment. The mock mirrors the interface with XOR decryption.
 *
 * WIRE: fhe_ser(ct) — serialize ciphertext to string (contract output format)
 *       Replace with OctraHFHE.decrypt(ciphertext, sk) when SDK ships.
 *       In-contract flow: ghost_predict returns fhe_ser(result); client decrypts via fhe_decrypt RPC.
 */
declare function decryptPayload(ciphertext: Uint8Array, pk: FHEPublicKey): Uint8Array;

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
declare const GHOST_RPC_PRIMARY = "https://octra.network/rpc";
declare const GHOST_RPC_FALLBACK = "https://rpc.octra.org";
type RpcMode = 'real' | 'mock';
/** Returns the current RPC mode ('real' or 'mock'). Pending becomes 'mock'. */
declare function getRpcMode(): RpcMode;
/** Returns the endpoint that responded, or the primary if in mock mode. */
declare function getActiveEndpoint(): string;
interface GhostNodeStatus {
    version?: string;
    chainId?: string;
    blockHeight?: number;
    peers?: number;
    /** Available RPC method names reported by the node */
    methods?: string[];
    [key: string]: unknown;
}
declare const GHOST_CIRCLE_DEPLOY_PAYLOAD: {
    readonly runtime: "octb";
    readonly privacy_class: "sealed";
    readonly browser_mode: "native_sealed";
    readonly resource_mode: "sealed_read";
    readonly code_b64: null;
    readonly policy_hash: null;
    readonly members_root: null;
    readonly export_policy: null;
    readonly limits: {
        readonly max_stable_bytes: "33554432";
        readonly max_assets_bytes: "33554432";
        readonly max_inline_value: "65536";
        readonly max_wasm_bytes: "33554432";
    };
};
/**
 * Derives the deterministic GhostCircle ID from the deploy payload,
 * deployer address, and nonce — mirrors Octra's circle_id derivation spec:
 *
 *   payload_hash = h256("octra:circle_deploy_payload:v1", json(payload))
 *   seed         = h256("octra:circle_deploy_id:v1", deployer_address, nonce, payload_hash)
 *   circle_id    = "oct" + base58(seed)[0:44]
 */
declare function deriveGhostCircleId(payload: object, deployerAddress: string, nonce: number): Promise<string>;
/**
 * Sends a single JSON-RPC 2.0 request to the active Octra node.
 *
 * On first call, automatically probes the primary and fallback endpoints.
 * Switches to mock mode if both are unreachable and returns null.
 * Subsequent calls skip the probe (cached result).
 */
declare function rpc(method: string, params: unknown[]): Promise<unknown>;
/**
 * Probes the primary and fallback Octra nodes, sets the module-level mode,
 * and returns it. Idempotent — subsequent calls return the cached result.
 */
declare function probeNode(): Promise<RpcMode>;
/**
 * Fetches the node status and the set of available RPC methods.
 * Returns null in mock mode.
 *
 * WIRE: node_status → result shape includes available_methods[]
 */
declare function ghostNodeStatus(): Promise<GhostNodeStatus | null>;
/**
 * Returns the on-chain nonce for a GhostCircle deployer address.
 * Returns 0 in mock mode.
 *
 * WIRE: octra_nonce(address) → number
 */
declare function ghostNonce(address: string): Promise<number>;
/**
 * Returns the OCT balance for an address in μOCT (1 OCT = 1_000_000 μOCT).
 * Returns 0n in mock mode.
 *
 * WIRE: octra_balance(address) → string|number in OCT
 */
declare function ghostBalance(address: string): Promise<bigint>;
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
declare function signOctraTx(txBody: Record<string, unknown>, privKeyHex: string): Record<string, unknown>;
/**
 * Submits a signed transaction to the Octra network.
 * Returns the tx hash, or a mock hash prefixed with "0xmock" in mock mode.
 *
 * WIRE: octra_submit(tx_json) → { tx_hash: string }
 */
declare function ghostSubmitTx(txJson: Record<string, unknown>): Promise<string>;
/**
 * Polls the status of a submitted transaction.
 * Returns null in mock mode or if the tx is not yet found.
 *
 * WIRE: octra_transaction(hash) → { status, result, ... }
 */
declare function ghostPollTx(hash: string): Promise<Record<string, unknown> | null>;
/**
 * Submits an AppliedML source string to the Octra compile RPC.
 * Returns base64-encoded bytecode, or the source encoded as base64 in mock mode.
 *
 * WIRE: compile(source) → { code_b64: string }
 *
 * NOTE: The exact method name for the compilation RPC is TBD — "compile" is
 * the likely name based on Octra docs but may differ per node_status.
 */
declare function ghostCompile(source: string): Promise<string>;
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
declare function ghostDeployCircle(deployerAddress: string, nonce: number, payload?: object): Promise<{
    circleId: string;
    txHash: string;
}>;
/**
 * Generates an FHE keypair on the Octra node.
 * Returns null in mock mode — callers must fall back to local mock key generation.
 *
 * WIRE: RPC method name unconfirmed — assumed 'fhe_keygen' based on Octra FHE group naming.
 *       Verify actual name via node_status before wiring to production.
 *       Expected response: { public_key_b64: string, key_id: string }
 */
declare function ghostFheKeygen(): Promise<{
    publicKeyB64: string;
    keyId: string;
} | null>;
/**
 * Encrypts data using the FHE public key held by the Octra node.
 * Returns null in mock mode — callers must fall back to local encryptPayload().
 *
 * WIRE: RPC method name unconfirmed — assumed 'fhe_encrypt'; verify via node_status.
 *       Expected response: { ciphertext_b64: string }
 *       In-contract equivalent: fhe_deser(ct) then fhe_scale / fhe_add operations.
 */
declare function ghostFheEncrypt(dataB64: string, keyId: string): Promise<string | null>;
/**
 * Decrypts an FHE ciphertext inside the sealed Circle (decryption key never leaves).
 * Returns null in mock mode — callers must fall back to local decryptPayload().
 *
 * WIRE: RPC method name unconfirmed — assumed 'fhe_decrypt'; verify via node_status.
 *       Expected response: { plaintext_b64: string }
 *       In-contract results arrive as fhe_ser() strings — deserialize with fhe_deser().
 */
declare function ghostFheDecrypt(ciphertextB64: string, keyId: string): Promise<string | null>;
declare class GhostRpcError extends Error {
    readonly method: string;
    readonly code: number;
    constructor(message: string, method: string, code: number);
}

/**
 * ghost-program.ts — Ghost AI's on-chain execution brain.
 *
 * This module defines the AppliedML (AML) program that runs inside a sealed
 * Octra Circle as the Ghost inference kernel. No node outside the sealed
 * environment ever sees plaintext queries or results — all reasoning happens
 * under HFHE (Homomorphic FHE) inside the GhostCircle.
 *
 * Lifecycle:
 *   1. ghostCompileProgram()  — compile AML source → base64 bytecode via Octra RPC
 *   2. ghostDeployProgram()   — deploy compiled bytecode into a sealed GhostCircle
 *   3. GhostCircle.ghost_predict(encryptedQuery) — sealed FHE inference on-chain
 *
 * In mock mode (Octra node unreachable) compile() returns a base64 stub and
 * deploy() returns a deterministic mock circle_id prefixed with "oct".
 */

/**
 * AppliedML source for the Ghost inference Circle.
 *
 * Accepts an HFHE-encrypted query vector, runs private_predict inside the
 * sealed environment using HFHE arithmetic, and returns encrypted result bytes.
 * The private key is generated at Circle init time and never exported.
 *
 * This is Ghost's on-chain brain — no plaintext query or inference result
 * is ever visible to any network node.
 */
declare const GHOST_PROGRAM_SOURCE = "contract GhostInference {\n  state {\n    owner: address\n    num_features: int\n    weights: map[int]int\n    bias: int\n    total_queries: int\n    query_log: map[address]int\n  }\n\n  constructor() {\n    self.owner = origin\n    self.num_features = 0\n    self.bias = 0\n    self.total_queries = 0\n  }\n\n  public fn set_weights(num_features: int, csv: string): bool {\n    require(caller == self.owner, \"not owner\")\n    require(num_features > 0, \"zero features\")\n    self.num_features = num_features\n    let n = parse_ints(csv, 2000)\n    for i in 0..n {\n      self.weights[i] = mget(2000 + i)\n    }\n    return true\n  }\n\n  public fn set_bias(b: int): bool {\n    require(caller == self.owner, \"not owner\")\n    self.bias = b\n    return true\n  }\n\n  public view fn ghost_predict(pk_addr: string, ct0: string, ct1: string): string {\n    let pk = fhe_load_pk(pk_addr)\n    let c0 = fhe_deser(ct0)\n    let c1 = fhe_deser(ct1)\n    let s0 = fhe_scale(pk, c0, self.weights[0])\n    let s1 = fhe_scale(pk, c1, self.weights[1])\n    let sum = fhe_add(pk, s0, s1)\n    let result = fhe_add_const(pk, sum, self.bias)\n    return fhe_ser(result)\n  }\n\n  public view fn ghost_predict_multi(pk_addr: string, cts: string, n: int): string {\n    require(n > 0, \"zero inputs\")\n    require(n <= self.num_features, \"too many features\")\n    let pk = fhe_load_pk(pk_addr)\n    let count = parse_ints(cts, 3000)\n    let acc = fhe_deser(mget(3000))\n    acc = fhe_scale(pk, acc, self.weights[0])\n    for i in 1..n {\n      let ct = fhe_deser(mget(3000 + i))\n      let scaled = fhe_scale(pk, ct, self.weights[i])\n      acc = fhe_add(pk, acc, scaled)\n    }\n    let result = fhe_add_const(pk, acc, self.bias)\n    return fhe_ser(result)\n  }\n\n  public fn log_query(): bool {\n    self.total_queries += 1\n    self.query_log[caller] += 1\n    return true\n  }\n\n  public view fn get_query_count(): int {\n    return self.total_queries\n  }\n\n  public view fn get_owner(): address {\n    return self.owner\n  }\n\n  public view fn get_num_features(): int {\n    return self.num_features\n  }\n}";
interface GhostProgram {
    /** AML source that was compiled */
    source: string;
    /** Base64-encoded bytecode returned by the Octra compile RPC */
    codeB64: string;
    /** Whether this was produced by the real Octra compile RPC or a mock stub */
    compiledOnChain: boolean;
}
interface GhostCircleDeployment {
    /** Octra circle_id in "oct..." format (or "0x..." mock prefix in mock mode) */
    circleId: string;
    /** On-chain deploy transaction hash */
    txHash: string;
    /** Circle handle for local state tracking */
    circle: Circle;
    /** Whether this deployment hit a real Octra node */
    deployedOnChain: boolean;
    /** Unix epoch ms when this deployment was submitted */
    deployedAt: number;
}
/**
 * Compiles the Ghost AppliedML program via the Octra compile RPC.
 *
 * In real mode: submits to Octra's compilation endpoint and returns bytecode.
 * In mock mode: returns a base64-encoded stub of the source for CI compatibility.
 *
 * WIRE: rpc("compile", [source]) → { code_b64: string }
 * NOTE: Exact compile method name TBD from node_status — "compile" is assumed.
 */
declare function ghostCompileProgram(source?: string): Promise<GhostProgram>;
/**
 * Deploys a compiled Ghost program into a sealed Octra Circle.
 *
 * In real mode: submits octra_submit with op_type=deploy_circle, derives the
 * deterministic circle_id, and returns the on-chain deployment descriptor.
 * In mock mode: derives a deterministic mock circle_id and returns a local stub.
 *
 * The deployed program payload includes the compiled bytecode in code_b64 so
 * the Octra runtime can instantiate the Ghost inference WASM.
 *
 * WIRE: ghostDeployCircle() → octra_submit({ op_type: "deploy_circle", ... })
 */
declare function ghostDeployProgram(keypair: PQCKeypair, program: GhostProgram, ou?: string): Promise<GhostCircleDeployment>;
/**
 * Convenience: compile the Ghost program source and immediately deploy it.
 * Returns the full deployment descriptor including the Circle handle.
 */
declare function ghostCompileAndDeploy(keypair: PQCKeypair, source?: string, ou?: string): Promise<GhostCircleDeployment>;

export { AgentCircle, type AgentConfig, type AuthProof, Circle, type CircleConfig, type CircleDeployConfig, type CircleInputs, type CircleResult, CircleSession, CircleSessionError, type CircleState, type CircleTx, type DeFiAction, type DeFiContext, type ExecutionPlan, type ExecutionResult, type ExecutionStep, FHEError, type FHEPublicKey, type FHEScaled, GHOST_CIRCLE_DEPLOY_PAYLOAD, GHOST_PROGRAM_SOURCE, GHOST_RPC_FALLBACK, GHOST_RPC_PRIMARY, type GhostCircleDeployment, type GhostNodeStatus, type GhostProgram, GhostRpcError, type InferenceResult, type NetworkInfo, OCTRA_TESTNET_URL, OctraClient, OctraConnectionError, type ParsedIntent, ProtocolNotAllowedError, type RpcMode, type SessionConfig, SpendingLimitError, type SpendingLimits, VeilLMClient, createAgentCircle, decryptPayload, deployCircle, deriveGhostCircleId, encryptPayload, fhe_add, fhe_load_pk, fhe_scale, getActiveEndpoint, getCircle, getRpcMode, ghostBalance, ghostCompile, ghostCompileAndDeploy, ghostCompileProgram, ghostDeployCircle, ghostDeployProgram, ghostFheDecrypt, ghostFheEncrypt, ghostFheKeygen, ghostNodeStatus, ghostNonce, ghostPollTx, ghostSubmitTx, probeNode, rpc, signOctraTx };
