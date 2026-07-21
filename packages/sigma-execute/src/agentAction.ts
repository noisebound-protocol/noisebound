import { ethToWei } from '@noisebound/sigma-core';
import type { Clock } from '@noisebound/sigma-core';
import { evaluateAction } from './evaluate.js';
import type { AgentMoneyActionRequest, ExecutionOutcome, OnChainMoneyActionRequest } from './types.js';

/**
 * Converts a model/agent-facing money request into the trusted, wei-based
 * {@link OnChainMoneyActionRequest} that the rest of sigma-execute operates
 * on. This is the single point where a decimal amount an LLM produced is
 * turned into wei — via {@link ethToWei}'s exact bigint arithmetic, never
 * float math and never model-produced wei. `amountCents`/`currency` are not
 * yet sourced from a price oracle for agent-originated requests, so they're
 * set to a neutral placeholder; they play no part in the escalation
 * decision for money requests (see evaluateEscalation), which is driven by
 * `amountWei`.
 */
export function fromAgentMoneyAction(request: AgentMoneyActionRequest): OnChainMoneyActionRequest {
  return {
    kind: 'on-chain-money',
    id: request.id,
    description: request.description,
    recipient: request.recipient,
    asset: request.asset,
    amountWei: ethToWei(request.amount),
    amountCents: 0,
    currency: request.asset,
  };
}

/**
 * The eventual agent-facing entry point: takes a raw model/agent money
 * request, converts its decimal amount to wei deterministically, and only
 * then runs it through the same escalation policy as any other action.
 * Validation/conversion of the amount always happens before escalation or
 * execution logic ever sees it.
 */
export function evaluateAgentAction(request: AgentMoneyActionRequest, clock: Clock): ExecutionOutcome {
  return evaluateAction(fromAgentMoneyAction(request), clock);
}
