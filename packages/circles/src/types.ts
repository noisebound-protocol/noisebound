import type { PQCKeypair } from '@noisebound/pqc-wallet';

export type { PQCKeypair };

/** ZK proof of biometric authentication (@noisebound/key-derive's auth counterpart). */
export interface AuthProof {
  proof: Uint8Array;
  publicInputs: string[];
}

// ─── Network ────────────────────────────────────────────────────────────────

export interface NetworkInfo {
  /** RPC endpoint that was pinged */
  endpoint: string;
  /** Number of transactions currently staged in the mempool */
  stagedTransactions: number;
  reachable: boolean;
  latencyMs: number;
}

// ─── Transactions ────────────────────────────────────────────────────────────

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
export interface CircleTx {
  from: string;         // oct... sender address
  to: string;           // oct... recipient address
  amount: string;       // μOCT (e.g. "1000000" = 1 OCT)
  nonce: number;        // replay-protection counter
  ou: string;           // fee tier: "1" < 1000 OCT, "3" >= 1000 OCT
  timestamp: number;    // Unix epoch seconds (float)
  message?: string;
}

// ─── Circles ─────────────────────────────────────────────────────────────────

export interface CircleDeployConfig {
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
export interface CircleConfig {
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
export interface CircleInputs {
  method: string;
  params: unknown[];
  /** μOCT to attach to the call (default "0") */
  amount?: string;
  /** Resource unit budget for execution (default "1000") */
  ou?: string;
}

export interface CircleResult {
  success: boolean;
  value: unknown;
  txHash?: string;
  error?: string;
}

export interface CircleState {
  address: string;
  fields: Record<string, unknown>;
  lastUpdated: number;   // Unix epoch ms
}

// ─── Agent ───────────────────────────────────────────────────────────────────

export interface SpendingLimits {
  maxPerTx: bigint;    // max μOCT per single transaction
  maxPerDay: bigint;   // max μOCT in any 24-hour rolling window
  maxTotal: bigint;    // max μOCT lifetime for this agent Circle
}

export interface AgentConfig {
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

export interface ExecutionStep {
  protocol: string;
  action: string;
  params: Record<string, unknown>;
  /** Estimated cost in μOCT */
  estimatedCost: bigint;
}

export interface ExecutionPlan {
  steps: ExecutionStep[];
  /** Total estimated cost in μOCT */
  estimatedCost: bigint;
  protocols: string[];
  intent: ParsedIntent;
}

export interface ExecutionResult {
  success: boolean;
  plan: ExecutionPlan;
  txHashes: string[];
  /** Actual cost in μOCT */
  actualCost: bigint;
  /** Unix epoch ms */
  timestamp: number;
  error?: string;
}

// ─── VeilLM Inference ────────────────────────────────────────────────────────

export type DeFiAction = 'swap' | 'lend' | 'borrow' | 'stake' | 'bridge' | 'unknown';

export interface ParsedIntent {
  action: DeFiAction;
  fromToken?: string;
  toToken?: string;
  amount?: string;
  protocol?: string;
  /** Tolerable slippage fraction (0–1) */
  slippageTolerance?: number;
  urgency: 'low' | 'medium' | 'high';
}

export interface DeFiContext {
  availableProtocols: string[];
  /** Token symbol → human-readable amount string */
  userBalances: Record<string, string>;
  gasPrice?: string;
  chainId?: string;
}

export interface InferenceResult {
  intent: ParsedIntent;
  /** Model confidence score 0–1 */
  confidence: number;
  rawResponse: string;
  modelVersion: string;
}

// ─── FHE ─────────────────────────────────────────────────────────────────────

/**
 * FHE public key loaded via fhe_load_pk.
 *
 * Scheme: CKKS (Cheon-Kim-Kim-Song) — approximate homomorphic encryption
 * suited for ML inference on real-valued vectors.
 *
 * TODO: When Octra FHE SDK ships, replace the 'ckks-mock' literal with the
 * real scheme identifier returned by OctraFHE.loadPublicKey(pkBytes).
 */
export interface FHEPublicKey {
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
export interface FHEScaled {
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
export interface SessionConfig {
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
