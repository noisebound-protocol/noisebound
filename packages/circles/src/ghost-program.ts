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

import { Circle } from './circle.js';
import {
  ghostCompile,
  ghostDeployCircle,
  deriveGhostCircleId,
  GHOST_CIRCLE_DEPLOY_PAYLOAD,
  GhostRpcError,
  getRpcMode,
  probeNode,
} from './octra-rpc.js';
import type { PQCKeypair } from '@noisebound/pqc-wallet';

// ─── Ghost AML inference program source ──────────────────────────────────────

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
export const GHOST_PROGRAM_SOURCE = `contract GhostInference {
  state {
    owner: address
    num_features: int
    weights: map[int]int
    bias: int
    total_queries: int
    query_log: map[address]int
  }

  constructor() {
    self.owner = origin
    self.num_features = 0
    self.bias = 0
    self.total_queries = 0
  }

  public fn set_weights(num_features: int, csv: string): bool {
    require(caller == self.owner, "not owner")
    require(num_features > 0, "zero features")
    self.num_features = num_features
    let n = parse_ints(csv, 2000)
    for i in 0..n {
      self.weights[i] = mget(2000 + i)
    }
    return true
  }

  public fn set_bias(b: int): bool {
    require(caller == self.owner, "not owner")
    self.bias = b
    return true
  }

  public view fn ghost_predict(pk_addr: string, ct0: string, ct1: string): string {
    let pk = fhe_load_pk(pk_addr)
    let c0 = fhe_deser(ct0)
    let c1 = fhe_deser(ct1)
    let s0 = fhe_scale(pk, c0, self.weights[0])
    let s1 = fhe_scale(pk, c1, self.weights[1])
    let sum = fhe_add(pk, s0, s1)
    let result = fhe_add_const(pk, sum, self.bias)
    return fhe_ser(result)
  }

  public view fn ghost_predict_multi(pk_addr: string, cts: string, n: int): string {
    require(n > 0, "zero inputs")
    require(n <= self.num_features, "too many features")
    let pk = fhe_load_pk(pk_addr)
    let count = parse_ints(cts, 3000)
    let acc = fhe_deser(mget(3000))
    acc = fhe_scale(pk, acc, self.weights[0])
    for i in 1..n {
      let ct = fhe_deser(mget(3000 + i))
      let scaled = fhe_scale(pk, ct, self.weights[i])
      acc = fhe_add(pk, acc, scaled)
    }
    let result = fhe_add_const(pk, acc, self.bias)
    return fhe_ser(result)
  }

  public fn log_query(): bool {
    self.total_queries += 1
    self.query_log[caller] += 1
    return true
  }

  public view fn get_query_count(): int {
    return self.total_queries
  }

  public view fn get_owner(): address {
    return self.owner
  }

  public view fn get_num_features(): int {
    return self.num_features
  }
}`;

// ─── GhostProgram compiled artifact ──────────────────────────────────────────

export interface GhostProgram {
  /** AML source that was compiled */
  source: string;
  /** Base64-encoded bytecode returned by the Octra compile RPC */
  codeB64: string;
  /** Whether this was produced by the real Octra compile RPC or a mock stub */
  compiledOnChain: boolean;
}

// ─── GhostCircle deployment descriptor ───────────────────────────────────────

export interface GhostCircleDeployment {
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

// ─── Compile ─────────────────────────────────────────────────────────────────

/**
 * Compiles the Ghost AppliedML program via the Octra compile RPC.
 *
 * In real mode: submits to Octra's compilation endpoint and returns bytecode.
 * In mock mode: returns a base64-encoded stub of the source for CI compatibility.
 *
 * WIRE: rpc("compile", [source]) → { code_b64: string }
 * NOTE: Exact compile method name TBD from node_status — "compile" is assumed.
 */
export async function ghostCompileProgram(
  source: string = GHOST_PROGRAM_SOURCE,
): Promise<GhostProgram> {
  await probeNode();
  const mode = getRpcMode();

  const codeB64 = await ghostCompile(source);

  return {
    source,
    codeB64,
    compiledOnChain: mode === 'real',
  };
}

// ─── Deploy ───────────────────────────────────────────────────────────────────

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
export async function ghostDeployProgram(
  keypair: PQCKeypair,
  program: GhostProgram,
  ou = '250000',
): Promise<GhostCircleDeployment> {
  await probeNode();
  const mode = getRpcMode();

  // Merge compiled bytecode into the deploy payload
  const payload = {
    ...GHOST_CIRCLE_DEPLOY_PAYLOAD,
    code_b64: program.codeB64,
  };

  let circleId: string;
  let txHash: string;
  let deployedOnChain = false;

  try {
    ({ circleId, txHash } = await ghostDeployCircle(keypair.address, 0, payload));
    deployedOnChain = mode === 'real';
  } catch (err) {
    // On-chain deploy failed (e.g. invalid address, malformed tx in test) — fall back
    // to deterministic mock values so callers stay functional without a live keypair.
    if (err instanceof GhostRpcError) {
      circleId = await deriveGhostCircleId(payload, keypair.address, 0);
      const preview = JSON.stringify({ address: keypair.address }).slice(0, 32);
      txHash = '0xmock' + Buffer.from(preview).toString('hex').slice(0, 58);
    } else {
      throw err;
    }
  }

  const circle = new Circle(
    circleId,
    `ghost-${circleId.slice(3, 11)}`,
    txHash,
    { owner: keypair.address, num_features: 0, bias: 0, total_queries: 0 },
  );

  return {
    circleId,
    txHash,
    circle,
    deployedOnChain,
    deployedAt: Date.now(),
  };
}

/**
 * Convenience: compile the Ghost program source and immediately deploy it.
 * Returns the full deployment descriptor including the Circle handle.
 */
export async function ghostCompileAndDeploy(
  keypair: PQCKeypair,
  source: string = GHOST_PROGRAM_SOURCE,
  ou = '250000',
): Promise<GhostCircleDeployment> {
  const program = await ghostCompileProgram(source);
  return ghostDeployProgram(keypair, program, ou);
}
