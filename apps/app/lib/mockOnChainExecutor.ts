import type { OnChainExecutor, OnChainMoneyActionRequest } from '@noisebound/sigma-execute';
import { DEMO_SESSION_CAPABILITY } from './demoSessionCapability';

function fakeTxHash(request: OnChainMoneyActionRequest): `0x${string}` {
  const seed = `${request.id}:${request.recipient}:${request.amountWei.toString()}`;
  let hex = '';
  for (let i = 0; i < seed.length; i += 1) {
    hex += seed.charCodeAt(i).toString(16).padStart(2, '0');
  }
  return `0x${hex.padEnd(64, '0').slice(0, 64)}`;
}

/**
 * Fake on-chain executor kept around for tests — the app now wires
 * {@link import('./realOnChainExecutor').createRealOnChainExecutor} by default.
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
