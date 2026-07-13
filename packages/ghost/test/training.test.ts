import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@noisebound/circles', async () => {
  const actual = await vi.importActual<typeof import('@noisebound/circles')>('@noisebound/circles');
  class MockCircleSession {
    async create(): Promise<void> {}
    async encryptQuery(prompt: string): Promise<Uint8Array> {
      return new TextEncoder().encode(`ct:${prompt}`);
    }
    async teardown(): Promise<void> {}
    get ghostCircleId(): string {
      return 'mock-circle-id';
    }
    get circle(): undefined {
      return undefined;
    }
  }
  return { ...actual, CircleSession: MockCircleSession };
});

import { GhostTrainer } from '../src/training/GhostTrainer.js';
import { FederatedCoordinator } from '../src/training/FederatedCoordinator.js';
import { TrainingScheduler } from '../src/training/TrainingScheduler.js';
import { pqcTransport, type PQCEnvelope } from '../src/crypto/PQCTransport.js';
import { fhe_load_pk, fhe_scale, fhe_add, type FHEScaled } from '@noisebound/circles';
import type { ExecutionPlan } from '../src/reasoning/types.js';

afterEach(() => {
  vi.restoreAllMocks();
});

const SAMPLE_PLAN: ExecutionPlan = {
  steps: [],
  estimatedGas: '0.10',
  estimatedOutcome: 'test',
  riskLevel: 'low',
  warnings: [],
  reasoning: [],
  requiresApproval: false,
  totalFees: '0.00',
  confidence: 0.9,
};

describe('GhostTrainer — encryption', () => {
  it('encrypts the intent and plan before storing them', async () => {
    const trainer = new GhostTrainer();
    await trainer.collectTrainingPair('borrow USDC against my ETH', SAMPLE_PLAN, 'success');
    const [pair] = await trainer.getEncryptedPairs();
    expect(pair.encryptedInput).not.toContain('borrow USDC against my ETH');
    expect(pair.encryptedOutput).not.toContain(JSON.stringify(SAMPLE_PLAN));
    expect(pair.encryptedInput.length).toBeGreaterThan(0);
  });

  it('never stores plaintext intent or plan text anywhere in the queue', async () => {
    const trainer = new GhostTrainer();
    const secretIntent = 'send 500 USDC to my private wallet';
    await trainer.collectTrainingPair(secretIntent, SAMPLE_PLAN, 'success');
    const [pair] = await trainer.getEncryptedPairs();
    const serialized = JSON.stringify(pair);
    expect(serialized).not.toContain(secretIntent);
    expect(serialized).not.toContain('500 USDC');
  });

  it('triggers a round once the queue hits maxQueueSize', async () => {
    const onRoundTrigger = vi.fn();
    const trainer = new GhostTrainer({ maxQueueSize: 2, onRoundTrigger });
    await trainer.collectTrainingPair('intent 1', SAMPLE_PLAN, 'success');
    expect(onRoundTrigger).not.toHaveBeenCalled();
    await trainer.collectTrainingPair('intent 2', SAMPLE_PLAN, 'success');
    expect(onRoundTrigger).toHaveBeenCalledTimes(1);
    expect(onRoundTrigger.mock.calls[0][0]).toHaveLength(2);
  });

  it('getEncryptedPairs clears the queue', async () => {
    const trainer = new GhostTrainer();
    await trainer.collectTrainingPair('intent', SAMPLE_PLAN, 'success');
    expect(trainer.queueSize).toBe(1);
    await trainer.getEncryptedPairs();
    expect(trainer.queueSize).toBe(0);
  });

  it('computeLocalGradient is sealed in a PQCEnvelope', async () => {
    const trainer = new GhostTrainer();
    await trainer.collectTrainingPair('intent A', SAMPLE_PLAN, 'success');
    const [pairA] = await trainer.getEncryptedPairs();
    const gradient = await trainer.computeLocalGradient([pairA]);
    const envelope = JSON.parse(gradient) as PQCEnvelope;
    expect(envelope.version).toBe('1.0');
    expect(envelope.kemCiphertext.length).toBeGreaterThan(0);
    expect(envelope.encryptedPayload).not.toContain('intent A');
  });

  it('computeLocalGradient is deterministic for identical pair batches once unsealed', async () => {
    const trainer = new GhostTrainer();
    await trainer.collectTrainingPair('intent A', SAMPLE_PLAN, 'success');
    const [pairA] = await trainer.getEncryptedPairs();
    const gradient1 = await trainer.computeLocalGradient([pairA]);
    const gradient2 = await trainer.computeLocalGradient([pairA]);
    const digest1 = await pqcTransport.unseal(JSON.parse(gradient1) as PQCEnvelope);
    const digest2 = await pqcTransport.unseal(JSON.parse(gradient2) as PQCEnvelope);
    expect(digest1).toBe(digest2);
  });

  it('computeLocalGradient differs for different pair batches once unsealed', async () => {
    const trainer = new GhostTrainer();
    await trainer.collectTrainingPair('intent A', SAMPLE_PLAN, 'success');
    const [pairA] = await trainer.getEncryptedPairs();
    await trainer.collectTrainingPair('intent B', SAMPLE_PLAN, 'failed');
    const [pairB] = await trainer.getEncryptedPairs();
    const gradientA = await trainer.computeLocalGradient([pairA]);
    const gradientB = await trainer.computeLocalGradient([pairB]);
    const digestA = await pqcTransport.unseal(JSON.parse(gradientA) as PQCEnvelope);
    const digestB = await pqcTransport.unseal(JSON.parse(gradientB) as PQCEnvelope);
    expect(digestA).not.toBe(digestB);
  });
});

describe('FederatedCoordinator', () => {
  it('reads the node registry address correctly', () => {
    const coordinator = new FederatedCoordinator();
    expect(coordinator.nodeRegistryAddress).toBe('0xed79Cf810eeF76F8a7379a79A1Be304f0CFE5f05');
  });

  it('getActiveNodes resolves to an empty array when the RPC is unreachable', async () => {
    const coordinator = new FederatedCoordinator({ rpcUrl: 'http://127.0.0.1:9' });
    const nodes = await coordinator.getActiveNodes();
    expect(nodes).toEqual([]);
  });

  it('aggregateGradients combines sealed gradients using fhe_add', async () => {
    const coordinator = new FederatedCoordinator();
    const rawGradients = ['deadbeef', 'cafebabe', '0a0b0c0d'];
    const sealedGradients = await Promise.all(
      rawGradients.map(async g => JSON.stringify(await pqcTransport.seal(g, pqcTransport.getPublicKey()))),
    );
    const result = await coordinator.aggregateGradients(sealedGradients);
    const unsealedResult = await pqcTransport.unseal(JSON.parse(result) as PQCEnvelope);

    const pk = fhe_load_pk(new TextEncoder().encode('veil-federated-coordinator-pk'));
    const toFloat = (g: string) => (parseInt(g.slice(0, 8), 16) || 0) / 0xffffffff;
    const expected = rawGradients
      .map(g => fhe_scale(toFloat(g), pk.scale))
      .reduce((acc: FHEScaled, v) => fhe_add(acc, v));

    expect(unsealedResult).toBe(expected.scaled.toString(16));
  });

  it('aggregateGradients throws on an empty gradient list', async () => {
    const coordinator = new FederatedCoordinator();
    await expect(coordinator.aggregateGradients([])).rejects.toThrow();
  });
});

describe('TrainingScheduler', () => {
  it('reports queue size from the attached trainer and stops cleanly', async () => {
    const trainer = new GhostTrainer();
    await trainer.collectTrainingPair('intent', SAMPLE_PLAN, 'success');
    const coordinator = new FederatedCoordinator({ rpcUrl: 'http://127.0.0.1:9' });
    const scheduler = new TrainingScheduler(60_000);

    scheduler.start(coordinator, trainer);
    const status = scheduler.getStatus();
    expect(status.queueSize).toBe(1);
    expect(status.nextRound).toBeGreaterThan(status.lastRound);

    expect(() => scheduler.stop()).not.toThrow();
  });
});
