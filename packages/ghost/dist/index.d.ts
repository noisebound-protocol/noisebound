import { PQCKeypair } from '@noisebound/pqc-wallet';

type GhostAction = 'swap' | 'send' | 'earn' | 'stake' | 'borrow' | 'repay' | 'provide_liquidity' | 'remove_liquidity' | 'bridge' | 'approve' | 'query' | 'complex' | 'clarify';
interface ParsedIntentParams {
    fromToken?: string;
    toToken?: string;
    amount?: string;
    amountIsPercent?: boolean;
    recipient?: string;
    protocol?: string;
    /** Free-text constraint, e.g. "no more than 10% interest" */
    constraint?: string;
    timeframe?: string;
    slippage?: number;
    maxGas?: string;
    queryType?: 'balance' | 'history' | 'price';
}
interface ParsedIntent {
    action: GhostAction;
    /** Model/rule confidence, 0-1 */
    confidence: number;
    params: ParsedIntentParams;
    requiresReasoning: boolean;
    raw: string;
    /** Human-readable Ghost response, always addresses the user as Sovereign */
    ghostResponse: string;
}
interface UserContext {
    address: string;
    network: 'base' | 'base-sepolia';
    balances: Record<string, string>;
    recentActions?: string[];
}

interface AaveTokenRates {
    supplyAPY: number;
    variableBorrowAPY: number;
    stableBorrowAPY: number;
    /** Loan-to-value ratio, 0-1 */
    ltv: number;
}
interface AaveData {
    rates: {
        USDC: AaveTokenRates;
        ETH: AaveTokenRates;
        WBTC: AaveTokenRates;
    };
    stale?: boolean;
    userPosition?: {
        collateral: Record<string, string>;
        debt: Record<string, string>;
        healthFactor: number;
    };
}
interface UniswapQuote {
    amountOut: string;
    priceImpact: number;
    route: string[];
    estimated?: boolean;
}
interface AerodromePool {
    poolAddress: string;
    token0: string;
    token1: string;
    apr: number;
    tvl: number;
    fee: number;
}
interface UniswapData {
    lastQuote?: UniswapQuote;
}
interface AerodromeData {
    pools?: AerodromePool[];
}
interface DeFiContext {
    balances: Record<string, string>;
    network: 'base' | 'base-sepolia';
    address: string;
    gasPrice?: string;
    protocols: {
        aave?: AaveData;
        uniswap?: UniswapData;
        aerodrome?: AerodromeData;
    };
}
interface ExecutionStep {
    index: number;
    protocol: string;
    action: string;
    description: string;
    params: Record<string, string>;
    estimatedGas: string;
    requiresApproval?: boolean;
    calldata?: string;
}
interface ExecutionPlan {
    steps: ExecutionStep[];
    estimatedGas: string;
    estimatedOutcome: string;
    riskLevel: 'low' | 'medium' | 'high';
    warnings: string[];
    /** Full chain-of-thought trace */
    reasoning: string[];
    requiresApproval: boolean;
    totalFees: string;
    confidence: number;
}

interface PQCLLMConfig {
    apiKey: string;
    model?: string;
    /** Forward-compatibility slot for Phase 2 TEE proxy. Empty = direct to Anthropic. */
    proxyUrl?: string;
    maxTokens?: number;
}
interface LLMMessage {
    role: 'user' | 'assistant';
    content: string;
}
declare class PQCLLMClient {
    private readonly config;
    private readonly pipeline;
    constructor(config: PQCLLMConfig);
    stream(messages: LLMMessage[], userContext: UserContext): AsyncGenerator<string, void, unknown>;
    chat(messages: LLMMessage[], userContext: UserContext): Promise<string>;
}

interface GhostConfig {
    network: 'base' | 'base-sepolia';
    apiUrl?: string;
    /** Default: true */
    enableTraining?: boolean;
    nodeId?: string;
    /** Used to sign execution steps in sign(). Generated lazily if omitted. */
    keypair?: PQCKeypair;
    /** When provided, 'clarify' intents are answered via de-identified LLM instead of a static string. */
    llmClient?: PQCLLMClient;
}
interface GhostResult {
    intent: ParsedIntent;
    /** Only present for intents that required the reasoning layer */
    plan?: ExecutionPlan;
    ghostResponse: string;
    executionReady: boolean;
    requiresClarification: boolean;
}
/**
 * Ghost — Veil's private AI agent. Single entry point for parsing user
 * intent, reasoning through DeFi execution, and signing the resulting plan.
 * Always addresses the user as Sovereign.
 */
declare class Ghost {
    private readonly parser;
    private readonly reasoner;
    private readonly trainer;
    private readonly config;
    private lastInstruction;
    constructor(config: GhostConfig);
    execute(instruction: string, context: UserContext): Promise<GhostResult>;
    /** Signs every step of an approved plan and broadcasts each signed step to api.veilprotocol.net/ghost/steps. */
    sign(plan: ExecutionPlan, context: UserContext): Promise<{
        txHashes: string[];
        success: boolean;
    }>;
    /** Streams Ghost's response token-by-token. Clarify intents pipe the Anthropic SSE stream
     *  through the generator; all other intents yield the static ghost response as a single chunk. */
    stream(instruction: string, context: UserContext): AsyncGenerator<string, void, unknown>;
    private signStep;
    private buildSyntheticPlan;
}

declare class IntentParser {
    private classifier;
    /**
     * Load the intent classifier. Tries DistilBertClassifier (ONNX, ~5-15 ms/inference)
     * first; gracefully falls back to EmbeddingClassifier (MiniLM k-NN) if the ONNX
     * model files aren't present (e.g. dev environments without a trained model).
     * Call once before using parseAsync(). Safe to skip — parse() stays sync.
     */
    initClassifier(): Promise<void>;
    /**
     * Embedding-primary intent parse.
     * Short inputs (≤ 2 words) take the fast regex path first; longer inputs go
     * through the MiniLM classifier, falling back to regex if the classifier
     * is not yet initialized.
     */
    parseAsync(input: string, context?: UserContext): Promise<ParsedIntent>;
    parse(input: string, _context?: UserContext): ParsedIntent;
    private matchRules;
    private extractParams;
    private scoreConfidence;
    private buildGhostResponse;
    private buildFromMatch;
    private blendConfidence;
    private buildClarify;
}

declare class DeFiReasoner {
    private aave;
    private uniswap;
    private aerodrome;
    private gas;
    reason(intent: ParsedIntent, context: UserContext): Promise<ExecutionPlan>;
    private reasonBorrow;
    private reasonSwap;
    private reasonEarn;
    private reasonRebalance;
    /** Parses "50% ETH, 50% USDC"-style allocation targets from free text. */
    private parseAllocations;
    private reasonDefault;
    private fetchDeFiContext;
}

interface TrainingPair {
    id: string;
    /** Base64 FHE ciphertext — the user's instruction is never stored in plaintext */
    encryptedInput: string;
    /** Base64 FHE ciphertext — the execution plan is never stored in plaintext */
    encryptedOutput: string;
    outcome: 'success' | 'failed' | 'cancelled';
    txHash?: string;
    timestamp: number;
    nodeId: string;
    /** Octra Circle that holds this pair */
    circleId?: string;
}
interface TrainingRound {
    roundId: string;
    startTime: number;
    nodeCount: number;
    pairsProcessed: number;
    encryptedModelHash: string;
    status: 'pending' | 'aggregating' | 'complete' | 'failed';
}

interface GhostTrainerOptions {
    keypair?: PQCKeypair;
    nodeId?: string;
    maxQueueSize?: number;
    /** Called when the queue fills up — wire to FederatedCoordinator.initiateTrainingRound */
    onRoundTrigger?: (pairs: TrainingPair[]) => void;
}
/**
 * GhostTrainer collects (intent, execution plan) pairs from every successful
 * Ghost run, encrypts them via an Octra GhostCircle (FHE), and queues them for
 * federated training. Plaintext intents and plans are never persisted.
 */
declare class GhostTrainer {
    private queue;
    private readonly maxQueueSize;
    private readonly keypair;
    private readonly nodeId;
    private readonly onRoundTrigger?;
    constructor(options?: GhostTrainerOptions);
    collectTrainingPair(intent: string, plan: ExecutionPlan, outcome: 'success' | 'failed' | 'cancelled', txHash?: string): Promise<void>;
    /**
     * Encrypts via an Octra GhostCircle (RLWE/FHE), then wraps each ciphertext
     * in a PQC envelope addressed to the Octra node before submission — so the
     * payload is never sent over the wire as plain FHE ciphertext, only as a
     * sealed PQCEnvelope. The returned strings are JSON-serialized envelopes,
     * not raw ciphertext.
     *
     * WIRE: OCTRA_NODE_PUBKEY is a placeholder until Octra publishes per-node
     * public keys via RPC (ghostPollTx / node_status) — see src/crypto/keys.ts.
     */
    encryptAndStore(input: string, output: string): Promise<{
        encryptedInput: string;
        encryptedOutput: string;
        circleId: string;
    }>;
    getEncryptedPairs(): Promise<TrainingPair[]>;
    get queueSize(): number;
    /**
     * Computes a local gradient over a batch of encrypted pairs, then seals it
     * before it ever leaves this node — the coordinator only ever sees a
     * PQCEnvelope, never the raw gradient digest.
     *
     * WIRE: once Octra's RPC exposes gradient computation, submit the pairs via
     * ghostSubmitTx with op type 'gradient_compute' and seal the resulting
     * encrypted gradient string. Today the pre-seal digest is a deterministic
     * hash of the encrypted pairs — correct interface, mock implementation.
     */
    computeLocalGradient(pairs: TrainingPair[]): Promise<string>;
}

interface FederatedCoordinatorOptions {
    apiUrl?: string;
    rpcUrl?: string;
    nodeRegistryAddress?: string;
}
/**
 * Coordinates federated training rounds across Ghost nodes.
 *
 * Node discovery reads VeilNodeRegistry.sol on Base Sepolia for the
 * authoritative registration state; round coordination (start/stop, weight
 * broadcast) talks to api.veilprotocol.net since there is no on-chain queue
 * for that traffic.
 */
declare class FederatedCoordinator {
    readonly nodeRegistryAddress: string;
    private readonly apiUrl;
    private readonly provider;
    constructor(options?: FederatedCoordinatorOptions);
    /**
     * Discovers active nodes by reading NodeRegistered events from
     * VeilNodeRegistry.sol, then confirming each is still registered via
     * isRegistered (excludes nodes that were later deregistered).
     */
    getActiveNodes(): Promise<string[]>;
    initiateTrainingRound(): Promise<TrainingRound>;
    /**
     * Aggregates per-node encrypted gradients using fhe_add. Each gradient
     * is a serialized PQCEnvelope (sealed by GhostTrainer.computeLocalGradient);
     * it is unsealed to recover the hex digest, mapped to an FHE-scaled value,
     * and homomorphically summed — no gradient is ever decrypted by anyone but
     * this coordinator, and it is never persisted in plaintext. The aggregate
     * is re-sealed before being returned to the caller.
     */
    aggregateGradients(nodeGradients: string[]): Promise<string>;
    commitModelHash(modelHash: string, roundId: string): Promise<string>;
    /**
     * Broadcasts weights wrapped in a PQC envelope.
     *
     * WIRE: ML-KEM-768 has no true broadcast mode — each recipient needs its
     * own encapsulation against its own KEM public key. Once the node registry
     * exposes per-node public keys, seal once per active node here instead of
     * sealing to COORDINATOR_PUBLIC_KEY.
     */
    broadcastWeights(encryptedWeights: string): Promise<void>;
    scheduleRound(intervalHours: number): Promise<void>;
}

interface TrainingSchedulerStatus {
    lastRound: number;
    nextRound: number;
    queueSize: number;
}
/**
 * Triggers federated training rounds when the encrypted pair queue fills up,
 * when the configured time interval elapses, or on manual request.
 */
declare class TrainingScheduler {
    private readonly intervalMs;
    private timer?;
    private lastRound;
    private nextRound;
    private coordinator?;
    private trainer?;
    constructor(intervalMs?: number);
    start(coordinator: FederatedCoordinator, trainer: GhostTrainer): void;
    stop(): void;
    /** Manually triggers a training round, e.g. from an API endpoint. */
    triggerNow(): Promise<void>;
    getStatus(): TrainingSchedulerStatus;
}

interface PQCEnvelope {
    kemCiphertext: string;
    encryptedPayload: string;
    senderPublicKey: string;
    signature: string;
    timestamp: number;
    version: '1.0';
}
interface PQCAuditEntry {
    timestamp: number;
    operation: 'seal' | 'unseal' | 'verify' | 'broadcast';
    payloadType: string;
    kemAlgorithm: 'ML-KEM-768';
    sigAlgorithm: 'ML-DSA-65';
    success: boolean;
}
declare function getAuditLog(): PQCAuditEntry[];
declare class PQCTransport {
    private keypair;
    init(existingPrivateKey?: string): Promise<void>;
    get isInitialized(): boolean;
    /** Serializes this node's keypair for persistence (see deserializeKeypair). */
    exportPrivateKey(): string;
    getPublicKey(): string;
    seal(payload: unknown, recipientPublicKey: string): Promise<PQCEnvelope>;
    unseal(envelope: PQCEnvelope): Promise<unknown>;
    verify(envelope: PQCEnvelope, senderPublicKey: string): Promise<boolean>;
    /** Records a broadcast audit entry (the broadcast itself reuses seal() for the envelope). */
    recordBroadcast(payloadType: string, success: boolean): void;
    /** Signs an arbitrary hash (e.g. a model commitment) with this node's ML-DSA-65 key. */
    signHash(hashHex: string): string;
    private requireKeypair;
}
/** Singleton transport instance for this node. */
declare const pqcTransport: PQCTransport;

interface DeidentificationVault {
    [placeholder: string]: string;
}
interface DeidentificationResult {
    sanitized: string;
    vault: DeidentificationVault;
}
declare const KNOWN_TOKENS: readonly ["USDC", "USDT", "DAI", "ETH", "WETH", "WBTC", "CBBTC", "CBETH", "OCT", "AERO", "WELL"];
declare class DeidentificationPipeline {
    /**
     * Replaces sensitive patterns with opaque placeholders. Pre-seeds vault
     * from UserContext so context.address and non-zero balances get deterministic
     * placeholder assignment when they appear in the message.
     * Bare numeric amounts without a known token suffix are intentionally not stripped.
     */
    deidentify(message: string, context: UserContext): DeidentificationResult;
    /**
     * Restores placeholders to their original values. Sorts longest placeholder
     * first so [AMOUNT_10] is replaced before [AMOUNT_1] in case of overlap.
     */
    reidentify(response: string, vault: DeidentificationVault): string;
}

/**
 * PQC peer key placeholders, pending live key distribution.
 *
 * WIRE: replace these with real lookups once key distribution exists —
 * COORDINATOR_PUBLIC_KEY from the coordinator's node-registry entry,
 * OCTRA_NODE_PUBKEY from Octra's node_status / ghostPollTx RPC response.
 *
 * When unset, the fallback is this process's own pqcTransport public key,
 * so seal()/unseal() round-trip correctly in local dev/tests where the
 * "node" and the "coordinator" are the same process. That round-trip stops
 * being meaningful — and a real distinct peer key is required — the moment
 * Ghost actually runs as separate node and coordinator processes.
 */
declare const COORDINATOR_PUBLIC_KEY: string;
declare const OCTRA_NODE_PUBKEY: string;

/**
 * Seed chain-of-thought training data for Ghost.
 *
 * 50 hand-curated (input, context, reasoning, plan, response) examples
 * covering Aave borrowing, yield optimization, portfolio rebalancing,
 * complex multi-step requests, and edge cases. The live federated training
 * pipeline (GhostTrainer / FederatedCoordinator) scales from this seed set.
 */
interface TrainingExample {
    input: string;
    context: UserContext;
    reasoning: string[];
    plan: ExecutionPlan;
    ghostResponse: string;
    warnings: string[];
}
declare const SEED_EXAMPLES: TrainingExample[];

declare function fetchBalances(address: string, rpcUrl: string): Promise<Record<string, string>>;

export { type AaveData, type AaveTokenRates, type AerodromeData, type AerodromePool, COORDINATOR_PUBLIC_KEY, type DeFiContext, DeFiReasoner, DeidentificationPipeline, type DeidentificationResult, type DeidentificationVault, type ExecutionPlan, type ExecutionStep, FederatedCoordinator, Ghost, type GhostAction, type GhostConfig, type GhostResult, GhostTrainer, IntentParser, KNOWN_TOKENS, type LLMMessage, OCTRA_NODE_PUBKEY, type PQCAuditEntry, type PQCEnvelope, PQCLLMClient, type PQCLLMConfig, PQCTransport, type ParsedIntent, type ParsedIntentParams, SEED_EXAMPLES, type TrainingExample, type TrainingPair, type TrainingRound, TrainingScheduler, type UniswapData, type UniswapQuote, type UserContext, fetchBalances, getAuditLog, pqcTransport };
