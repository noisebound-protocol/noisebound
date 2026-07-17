import { describe, expect, it } from 'vitest';
import { executeConfirmedAction } from '../execute.js';
import type { ExecutionRegistry } from '../types.js';
import { FakeClock } from './fakeClock.js';
import {
  buildCloudInferenceRequest,
  buildOnChainMoneyRequest,
  freshRevocationRegistry,
  issueCapabilityFixture,
  revokeSessionCapability,
} from './fixtures.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildRegistry(overrides: Partial<ExecutionRegistry> & Pick<ExecutionRegistry, 'identityPublicKey'>): ExecutionRegistry {
  return {
    revocationRegistry: freshRevocationRegistry(),
    onChain: {
      send: async () => {
        throw new Error('onChain.send not configured for this test');
      },
    },
    issuerPublicKey: undefined as unknown as ExecutionRegistry['issuerPublicKey'],
    redemptionRegistry: undefined as unknown as ExecutionRegistry['redemptionRegistry'],
    ...overrides,
  };
}

describe('executeConfirmedAction', () => {
  const clock = new FakeClock(new Date('2026-07-17T12:00:00.000Z'));

  it('fails closed when the capability has expired by execution time, even though it was valid when issued', async () => {
    const { identityKeyPair, capability } = issueCapabilityFixture(
      { maxSpendWei: (10n ** 18n).toString() },
      10,
    );
    const request = buildOnChainMoneyRequest();
    const registry = buildRegistry({ identityPublicKey: identityKeyPair.publicKey });

    await sleep(30);

    const outcome = await executeConfirmedAction(request, capability, registry, clock);

    expect(outcome.status).toBe('execution-failed');
    if (outcome.status === 'execution-failed') {
      expect(outcome.reason).toMatch(/expired|revoked|invalid/i);
    }
    expect(outcome.timestamp).toEqual(new Date('2026-07-17T12:00:00.000Z'));
  });

  it('fails closed when the capability has been revoked by execution time', async () => {
    const { identityKeyPair, capability } = issueCapabilityFixture();
    const revocationRegistry = freshRevocationRegistry();
    revokeSessionCapability(revocationRegistry, capability);

    const request = buildOnChainMoneyRequest();
    const registry = buildRegistry({
      identityPublicKey: identityKeyPair.publicKey,
      revocationRegistry,
    });

    const outcome = await executeConfirmedAction(request, capability, registry, clock);

    expect(outcome.status).toBe('execution-failed');
  });

  it('returns executed with a real tx hash on successful on-chain execution', async () => {
    const { identityKeyPair, capability } = issueCapabilityFixture({
      maxSpendWei: (10n ** 18n).toString(),
    });
    const request = buildOnChainMoneyRequest({ amountWei: 500_000_000_000_000_000n });
    const expectedTxHash = '0xabc123def4567890abc123def4567890abc123def4567890abc123def45678' as const;

    const registry = buildRegistry({
      identityPublicKey: identityKeyPair.publicKey,
      onChain: {
        send: async (req, cap) => {
          expect(req.id).toBe(request.id);
          expect(cap.payload.id).toBe(capability.payload.id);
          return expectedTxHash;
        },
      },
    });

    const outcome = await executeConfirmedAction(request, capability, registry, clock);

    expect(outcome.status).toBe('executed');
    if (outcome.status === 'executed' && outcome.result.kind === 'on-chain-money') {
      expect(outcome.result.txHash).toBe(expectedTxHash);
    }
    expect(outcome.timestamp).toEqual(new Date('2026-07-17T12:00:00.000Z'));
  });

  it('fails execution when the requested amount exceeds the capability scope, without calling the executor', async () => {
    const { identityKeyPair, capability } = issueCapabilityFixture({
      maxSpendWei: (1_000n).toString(),
    });
    const request = buildOnChainMoneyRequest({ amountWei: 1_000_000n });

    let sendCalled = false;
    const registry = buildRegistry({
      identityPublicKey: identityKeyPair.publicKey,
      onChain: {
        send: async () => {
          sendCalled = true;
          return '0x0';
        },
      },
    });

    const outcome = await executeConfirmedAction(request, capability, registry, clock);

    expect(outcome.status).toBe('execution-failed');
    expect(sendCalled).toBe(false);
  });

  it('returns execution-failed preserving the underlying reason when cloud attestation fails', async () => {
    const { identityKeyPair, capability } = issueCapabilityFixture();
    const { request, issuerKeyPair, redemptionRegistry } = await buildCloudInferenceRequest(
      {},
      { overallResult: false },
    );

    const registry = buildRegistry({
      identityPublicKey: identityKeyPair.publicKey,
      issuerPublicKey: issuerKeyPair.publicKey,
      redemptionRegistry,
    });

    const outcome = await executeConfirmedAction(request, capability, registry, clock);

    expect(outcome.status).toBe('execution-failed');
    if (outcome.status === 'execution-failed') {
      expect(outcome.reason).toMatch(/attestation-failed/);
      expect(outcome.cause?.status).toBe('attestation-failed');
    }
  });

  it('returns executed with the cloud-request outcome on successful cloud execution', async () => {
    const { identityKeyPair, capability } = issueCapabilityFixture();
    const { request, issuerKeyPair, redemptionRegistry } = await buildCloudInferenceRequest();

    const registry = buildRegistry({
      identityPublicKey: identityKeyPair.publicKey,
      issuerPublicKey: issuerKeyPair.publicKey,
      redemptionRegistry,
    });

    const outcome = await executeConfirmedAction(request, capability, registry, clock);

    expect(outcome.status).toBe('executed');
    if (outcome.status === 'executed' && outcome.result.kind === 'cloud-inference') {
      expect(outcome.result.outcome.status).toBe('authorized');
    }
  });
});
