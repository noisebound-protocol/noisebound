import { createEthersOnChainExecutor } from '@noisebound/sigma-execute';
import type { OnChainExecutor, OnChainMoneyActionRequest } from '@noisebound/sigma-execute';
import type { SessionCapability } from '@noisebound/pqc-wallet';
import { resolveSessionKey } from './sessionKeyRegistry';

/** Real on-chain executor, wired to the app's session key registry. Signs and broadcasts for real. */
export function createRealOnChainExecutor(): OnChainExecutor {
  return createEthersOnChainExecutor(resolveSessionKey);
}

/** Runs a confirmed on-chain-money request through the injected executor, using the caller's real session capability. */
export function executeRealOnChainAction(
  request: OnChainMoneyActionRequest,
  executor: OnChainExecutor,
  sessionCapability: SessionCapability,
): Promise<`0x${string}`> {
  return executor.send(request, sessionCapability);
}
