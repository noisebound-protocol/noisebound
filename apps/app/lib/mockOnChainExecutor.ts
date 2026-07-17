import type { OnChainExecutor, OnChainMoneyActionRequest } from '@noisebound/sigma-execute';
import type { SessionCapability } from '@noisebound/pqc-wallet';

/**
 * Demo-only stand-in for a real signed session capability. The mock executor
 * below never inspects it — it exists purely so call sites can satisfy
 * OnChainExecutor's real signature ahead of session-capability wiring.
 */
const DEMO_SESSION_CAPABILITY: SessionCapability = {
  payload: {
    id: 'demo-session',
    sessionAddress: '0x000000000000000000000000000000000000ad',
    sessionPublicKey: '0x00',
    scope: { maxSpendWei: '0' },
    issuedAt: 0,
    expiresAt: 0,
  },
  signature: new Uint8Array(),
};

function fakeTxHash(request: OnChainMoneyActionRequest): `0x${string}` {
  const seed = `${request.id}:${request.recipient}:${request.amountWei.toString()}`;
  let hex = '';
  for (let i = 0; i < seed.length; i += 1) {
    hex += seed.charCodeAt(i).toString(16).padStart(2, '0');
  }
  return `0x${hex.padEnd(64, '0').slice(0, 64)}`;
}

/**
 * Stand-in for the real on-chain executor landing in build/onchain-executor.
 * Swap this factory's implementation for the real one once that branch
 * merges — every call site that depends on it stays unchanged.
 */
export function createMockOnChainExecutor(): OnChainExecutor {
  return {
    async send(request) {
      return fakeTxHash(request);
    },
  };
}

/** Runs a confirmed on-chain-money request through the injected executor. */
export function executeMockOnChainAction(
  request: OnChainMoneyActionRequest,
  executor: OnChainExecutor,
): Promise<`0x${string}`> {
  return executor.send(request, DEMO_SESSION_CAPABILITY);
}
