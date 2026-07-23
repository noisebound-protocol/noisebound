import { evaluateEscalation } from '@noisebound/sigma-core';
import type { Clock, EscalationRequest } from '@noisebound/sigma-core';
import { buildConfirmationSummary } from './confirmation.js';
import { checkRecipientSafety } from './recipientSafety.js';
import type { RecipientHistory, RecipientSafetySignal } from './recipientSafety.js';
import type { ActionRequest, ExecutionOutcome } from './types.js';

function toEscalationRequest(request: ActionRequest, recipientSafety?: RecipientSafetySignal): EscalationRequest {
  switch (request.kind) {
    case 'on-chain-money':
      return {
        category: 'money',
        id: request.id,
        description: request.description,
        amountCents: request.amountCents,
        currency: request.currency,
        amountWei: request.amountWei,
        isKnownRecipient: recipientSafety?.isKnownRecipient,
        flaggedPattern: recipientSafety?.flaggedPattern ?? null,
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
 * Runs a proposed action through the recipient-safety guard (money actions
 * only) and then sigma-core's escalation policy. Money actions that
 * hard-deny — either because the escalation policy said so or because the
 * recipient-safety guard flagged a burn/malformed address — stop here;
 * everything else that needs a human in the loop comes back as
 * 'awaiting-confirmation' — or, for a money request above the spend
 * threshold or to an unverified recipient, 'requires-secondary-confirmation'
 * — carrying the real confirmation text. Actual execution only happens via
 * executeConfirmedAction, once a human has approved that payload.
 *
 * `recipientHistory`, if supplied, is consulted for the novelty gate (has
 * this user/session sent to this address before?) and updated with the
 * request's recipient once evaluated, so a repeat send to the same address
 * no longer counts as novel. Without one, novelty is not considered —
 * pattern-based flags (burn/malformed addresses) still apply regardless.
 */
export function evaluateAction(
  request: ActionRequest,
  clock: Clock,
  recipientHistory?: RecipientHistory,
): ExecutionOutcome {
  const recipientSafety =
    request.kind === 'on-chain-money' ? checkRecipientSafety(request.recipient, recipientHistory) : undefined;
  if (request.kind === 'on-chain-money') {
    recipientHistory?.markSeen(request.recipient);
  }

  const decision = evaluateEscalation(toEscalationRequest(request, recipientSafety));
  const timestamp = clock.now();

  if (decision === 'deny') {
    return {
      status: 'denied',
      requestId: request.id,
      reason:
        recipientSafety?.flaggedPattern != null
          ? `Escalation policy denied this ${request.kind} request: recipient flagged as ${recipientSafety.flaggedPattern}`
          : `Escalation policy denied this ${request.kind} request`,
      timestamp,
    };
  }

  const confirmation = {
    requestId: request.id,
    summary: buildConfirmationSummary(request),
  };

  if (decision === 'require-secondary-confirmation') {
    return {
      status: 'requires-secondary-confirmation',
      requestId: request.id,
      confirmation,
      timestamp,
    };
  }

  return {
    status: 'awaiting-confirmation',
    requestId: request.id,
    confirmation,
    timestamp,
  };
}
