'use server';

import 'server-only';
import type { ExecutionOutcome } from '@noisebound/sigma-execute';
import { evaluateActionRequest } from '../../lib/actionTrigger';

/**
 * Wire form of an on-chain-money ActionRequest — amountWei as a string since
 * bigint shouldn't cross the server action boundary (same convention as
 * SessionCapabilityScope.maxSpendWei).
 */
export interface SendActionInput {
  readonly id: string;
  readonly description: string;
  readonly amountCents: number;
  readonly currency: string;
  readonly amountWei: string;
  readonly recipient: `0x${string}`;
  readonly asset: string;
}

/** Builds the real on-chain-money ActionRequest and evaluates it via sigma-execute. */
export async function evaluateSendActionTrigger(input: SendActionInput): Promise<ExecutionOutcome> {
  return evaluateActionRequest({
    kind: 'on-chain-money',
    id: input.id,
    description: input.description,
    amountCents: input.amountCents,
    currency: input.currency,
    amountWei: BigInt(input.amountWei),
    recipient: input.recipient,
    asset: input.asset,
  });
}
