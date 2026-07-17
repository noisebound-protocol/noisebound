import { evaluateEscalation } from '@noisebound/sigma-core';
import type { Clock, EscalationRequest } from '@noisebound/sigma-core';
import { buildConfirmationSummary } from './confirmation.js';
import type { ActionRequest, ExecutionOutcome } from './types.js';

function toEscalationRequest(request: ActionRequest): EscalationRequest {
  switch (request.kind) {
    case 'on-chain-money':
      return {
        category: 'money',
        id: request.id,
        description: request.description,
        amountCents: request.amountCents,
        currency: request.currency,
      };
    case 'cloud-inference':
      return {
        category: 'external-api',
        id: request.id,
        description: request.description,
        requiresDisclosure: request.requiresDisclosure,
      };
  }
}

/**
 * Runs a proposed action through sigma-core's escalation policy. Money
 * actions that hard-deny stop here; everything else that needs a human in
 * the loop comes back as 'awaiting-confirmation' carrying the real
 * confirmation text — actual execution only happens via
 * executeConfirmedAction, once a human has approved that payload.
 */
export function evaluateAction(request: ActionRequest, clock: Clock): ExecutionOutcome {
  const decision = evaluateEscalation(toEscalationRequest(request));
  const timestamp = clock.now();

  if (decision === 'deny') {
    return {
      status: 'denied',
      requestId: request.id,
      reason: `Escalation policy denied this ${request.kind} request`,
      timestamp,
    };
  }

  return {
    status: 'awaiting-confirmation',
    requestId: request.id,
    confirmation: {
      requestId: request.id,
      summary: buildConfirmationSummary(request),
    },
    timestamp,
  };
}
