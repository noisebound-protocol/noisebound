import { createHash } from 'node:crypto';
import { CircleSession, type DeFiContext } from '@noisebound/circles';
import { generatePQCKeypair, type PQCKeypair } from '@noisebound/pqc-wallet';
import { pqcTransport } from '../crypto/PQCTransport.js';
import { OCTRA_NODE_PUBKEY, COORDINATOR_PUBLIC_KEY } from '../crypto/keys.js';
import type { ExecutionPlan } from '../reasoning/types.js';
import type { TrainingPair } from './types.js';

export interface GhostTrainerOptions {
  keypair?: PQCKeypair;
  nodeId?: string;
  maxQueueSize?: number;
  /** Called when the queue fills up — wire to FederatedCoordinator.initiateTrainingRound */
  onRoundTrigger?: (pairs: TrainingPair[]) => void;
}

/** Placeholder DeFiContext fed into CircleSession.encryptQuery for generic string encryption. */
const EMPTY_CIRCLE_CONTEXT: DeFiContext = { availableProtocols: [], userBalances: {} };

/**
 * GhostTrainer collects (intent, execution plan) pairs from every successful
 * Ghost run, encrypts them via an Octra GhostCircle (FHE), and queues them for
 * federated training. Plaintext intents and plans are never persisted.
 */
export class GhostTrainer {
  private queue: TrainingPair[] = [];
  private readonly maxQueueSize: number;
  private readonly keypair: PQCKeypair;
  private readonly nodeId: string;
  private readonly onRoundTrigger?: (pairs: TrainingPair[]) => void;

  constructor(options: GhostTrainerOptions = {}) {
    this.keypair = options.keypair ?? generatePQCKeypair();
    this.nodeId = options.nodeId ?? `node-${this.keypair.address.slice(2, 10)}`;
    this.maxQueueSize = options.maxQueueSize ?? 10_000;
    this.onRoundTrigger = options.onRoundTrigger;
  }

  async collectTrainingPair(
    intent: string,
    plan: ExecutionPlan,
    outcome: 'success' | 'failed' | 'cancelled',
    txHash?: string,
  ): Promise<void> {
    const { encryptedInput, encryptedOutput, circleId } = await this.encryptAndStore(
      intent,
      JSON.stringify(plan),
    );

    const pair: TrainingPair = {
      id: `tp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      encryptedInput,
      encryptedOutput,
      outcome,
      txHash,
      timestamp: Date.now(),
      nodeId: this.nodeId,
      circleId,
    };

    this.queue.push(pair);

    if (this.queue.length >= this.maxQueueSize) {
      const pairs = await this.getEncryptedPairs();
      this.onRoundTrigger?.(pairs);
    }
  }

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
  async encryptAndStore(
    input: string,
    output: string,
  ): Promise<{ encryptedInput: string; encryptedOutput: string; circleId: string }> {
    const session = new CircleSession({ keypair: this.keypair, reuse: true });
    await session.create();
    try {
      const inputCt = await session.encryptQuery(input, EMPTY_CIRCLE_CONTEXT);
      const outputCt = await session.encryptQuery(output, EMPTY_CIRCLE_CONTEXT);
      const circleId = session.ghostCircleId ?? session.circle?.address ?? 'unknown';

      const inputEnvelope = await pqcTransport.seal(Buffer.from(inputCt).toString('base64'), OCTRA_NODE_PUBKEY);
      const outputEnvelope = await pqcTransport.seal(Buffer.from(outputCt).toString('base64'), OCTRA_NODE_PUBKEY);

      return {
        encryptedInput: JSON.stringify(inputEnvelope),
        encryptedOutput: JSON.stringify(outputEnvelope),
        circleId,
      };
    } finally {
      await session.teardown();
    }
  }

  async getEncryptedPairs(): Promise<TrainingPair[]> {
    const pairs = this.queue;
    this.queue = [];
    return pairs;
  }

  get queueSize(): number {
    return this.queue.length;
  }

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
  async computeLocalGradient(pairs: TrainingPair[]): Promise<string> {
    const hash = createHash('sha256');
    for (const pair of pairs) {
      hash.update(pair.encryptedInput);
      hash.update(pair.encryptedOutput);
    }
    const digest = hash.digest('hex');

    return JSON.stringify(await pqcTransport.seal(digest, COORDINATOR_PUBLIC_KEY));
  }
}
