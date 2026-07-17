'use server';

import 'server-only';
import type { OnChainMoneyActionRequest } from '@noisebound/sigma-execute';
import { createRealOnChainExecutor, executeRealOnChainAction } from '../../lib/realOnChainExecutor';

/**
 * Wire form of a confirmed OnChainMoneyActionRequest — amountWei as a string
 * since bigint shouldn't cross the server action boundary (same convention
 * as SendActionInput in actionTrigger.ts).
 */
export interface ExecuteOnChainMoneyActionInput {
  readonly id: string;
  readonly description: string;
  readonly amountCents: number;
  readonly currency: string;
  readonly amountWei: string;
  readonly recipient: `0x${string}`;
  readonly asset: string;
}

/**
 * Signs and broadcasts a confirmed on-chain-money action for real, resolving
 * the session key server-side so its private key never crosses into the
 * browser. The single injection point for the real vs. mock executor.
 */
export async function executeOnChainMoneyAction(
  input: ExecuteOnChainMoneyActionInput,
): Promise<`0x${string}`> {
  const request: OnChainMoneyActionRequest = {
    kind: 'on-chain-money',
    id: input.id,
    description: input.description,
    amountCents: input.amountCents,
    currency: input.currency,
    amountWei: BigInt(input.amountWei),
    recipient: input.recipient,
    asset: input.asset,
  };

  const executor = createRealOnChainExecutor();
  return executeRealOnChainAction(request, executor);
}
