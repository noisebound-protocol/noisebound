/**
 * Escalation categories that are not money. Kept as a separate type (rather
 * than a field on a single request shape) so that a money request can never
 * carry an override/allow flag — the money branch of {@link EscalationRequest}
 * simply has no field that could ever loosen the decision.
 */
export type NonMoneyEscalationCategory = 'external-api' | 'data-sharing' | 'irreversible-action';

interface BaseEscalationRequest {
  readonly id: string;
  readonly description: string;
}

/**
 * An escalation request that touches real money. Deliberately has no
 * override, priority, or "always allow" field of any kind — there is no
 * value that can be placed in this type that changes the outcome of
 * {@link evaluateEscalation}.
 */
export interface MoneyEscalationRequest extends BaseEscalationRequest {
  readonly category: 'money';
  readonly amountCents: number;
  readonly currency: string;
}

/** An escalation request that does not touch real money. */
export interface NonMoneyEscalationRequest extends BaseEscalationRequest {
  readonly category: NonMoneyEscalationCategory;
  readonly requiresDisclosure: boolean;
}

export type EscalationRequest = MoneyEscalationRequest | NonMoneyEscalationRequest;

export type EscalationDecision = 'allow' | 'deny' | 'require-disclosure';

/**
 * Evaluates whether an action may leave the private zone.
 *
 * Any request in the `money` category is hard-denied. This is not a
 * configurable rule: `MoneyEscalationRequest` has no field that could flip
 * the branch below, so there is no override to plumb through and no
 * "always allow" toggle to disable.
 */
export function evaluateEscalation(request: EscalationRequest): EscalationDecision {
  if (request.category === 'money') {
    return 'deny';
  }

  return request.requiresDisclosure ? 'require-disclosure' : 'allow';
}
