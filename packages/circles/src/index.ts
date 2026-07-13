/**
 * @veil/circles — Octra Circle interface for private agent execution.
 *
 * Circles are sealed FHE execution environments on the Octra blockchain.
 * Veil uses them for private DeFi routing, PQC key management, and
 * Ghost AI inference — the sealed on-chain execution layer for Ghost.
 *
 * Status: RPC wired to real Octra mainnet with graceful mock fallback.
 * Ghost inference: GhostCircle + AppliedML program in ghost-program.ts.
 */

export { OctraClient, OctraConnectionError, OCTRA_TESTNET_URL } from './client.js';

export { Circle, deployCircle, getCircle } from './circle.js';

export {
  AgentCircle,
  createAgentCircle,
  SpendingLimitError,
  ProtocolNotAllowedError,
} from './agent.js';

export { VeilLMClient } from './inference.js';

export {
  CircleSession,
  CircleSessionError,
} from './session.js';

export {
  FHEError,
  fhe_load_pk,
  fhe_scale,
  fhe_add,
  encryptPayload,
  decryptPayload,
} from './fhe.js';

export {
  // RPC client
  rpc,
  probeNode,
  getRpcMode,
  getActiveEndpoint,
  ghostNodeStatus,
  ghostNonce,
  ghostBalance,
  ghostSubmitTx,
  signOctraTx,
  ghostPollTx,
  ghostCompile,
  ghostDeployCircle,
  ghostFheKeygen,
  ghostFheEncrypt,
  ghostFheDecrypt,
  deriveGhostCircleId,
  GhostRpcError,
  GHOST_RPC_PRIMARY,
  GHOST_RPC_FALLBACK,
  GHOST_CIRCLE_DEPLOY_PAYLOAD,
} from './octra-rpc.js';

export {
  // Ghost inference program
  GHOST_PROGRAM_SOURCE,
  ghostCompileProgram,
  ghostDeployProgram,
  ghostCompileAndDeploy,
} from './ghost-program.js';

export type {
  // Network
  NetworkInfo,
  CircleTx,
  // Circles
  CircleConfig,
  CircleDeployConfig,
  CircleInputs,
  CircleResult,
  CircleState,
  // Agent
  AgentConfig,
  SpendingLimits,
  ExecutionPlan,
  ExecutionStep,
  ExecutionResult,
  // Inference
  DeFiContext,
  InferenceResult,
  ParsedIntent,
  DeFiAction,
  // FHE
  FHEPublicKey,
  FHEScaled,
  SessionConfig,
  // Re-exports
  PQCKeypair,
  AuthProof,
} from './types.js';

export type { GhostNodeStatus, RpcMode } from './octra-rpc.js';
export type { GhostProgram, GhostCircleDeployment } from './ghost-program.js';
