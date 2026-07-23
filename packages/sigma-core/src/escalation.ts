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
 * value that can be placed in this type that skips the confirmation flow in
 * {@link evaluateEscalation}. `amountWei` is optional so that callers who
 * only track a fiat amount still get a (single-confirm) decision; it is
 * required only to unlock the secondary-confirmation threshold check.
 */
export interface MoneyEscalationRequest extends BaseEscalationRequest {
  readonly category: 'money';
  readonly amountCents: number;
  readonly currency: string;
  readonly amountWei?: bigint;
  /**
   * Whether the recipient has been seen before by this user/session, per a
   * recipient-safety guard run ahead of escalation (e.g. sigma-execute's
   * `checkRecipientSafety`). `undefined` means no guard result was supplied
   * (novelty is not considered); `false` means the guard explicitly flagged
   * the recipient as unverified, which is treated as elevated risk.
   */
  readonly isKnownRecipient?: boolean | undefined;
  /**
   * A short machine-readable reason a recipient-safety guard flagged this
   * request's recipient (e.g. a burn-address or malformed-address pattern),
   * or `null`/`undefined` if the guard found nothing. Any non-empty value
   * here is treated as disqualifying — see {@link evaluateEscalation}.
   */
  readonly flaggedPattern?: string | null;
}

/** An escalation request that does not touch real money. */
export interface NonMoneyEscalationRequest extends BaseEscalationRequest {
  readonly category: NonMoneyEscalationCategory;
  readonly requiresDisclosure: boolean;
}

export type EscalationRequest = MoneyEscalationRequest | NonMoneyEscalationRequest;

export type EscalationDecision =
  | 'allow'
  | 'deny'
  | 'require-disclosure'
  | 'require-confirmation'
  | 'require-secondary-confirmation';

/** Governs how much friction a money escalation must clear before execution. */
export interface MoneyEscalationOptions {
  /**
   * Spend threshold, in wei. Money requests at or below this amount need a
   * single explicit confirmation; requests above it need a second, separate
   * explicit confirmation on top of the first.
   */
  readonly maxSpendWei: bigint;
}

/** 1 ETH, in wei. A conservative default for callers that don't configure their own. */
const DEFAULT_MAX_SPEND_WEI = 1_000_000_000_000_000_000n;

export const DEFAULT_MONEY_ESCALATION_OPTIONS: MoneyEscalationOptions = {
  maxSpendWei: DEFAULT_MAX_SPEND_WEI,
};

/** Confirmation state gathered from a human for a single escalation request. */
export interface EscalationConfirmation {
  readonly confirmed: boolean;
  /** Only required (and only checked) once the request clears the secondary-confirmation threshold. */
  readonly secondaryConfirmed?: boolean;
}

/**
 * Evaluates whether an action may leave the private zone.
 *
 * Money requests are default-deny in the sense that they never auto-execute:
 * every money request comes back as `require-confirmation` or
 * `require-secondary-confirmation`, never `allow`, no matter how small the
 * amount. There is no field on {@link MoneyEscalationRequest} that can skip
 * this — the only way a money action ever executes is through
 * {@link confirmEscalation} after a human has actually confirmed it.
 *
 * A recipient-safety guard result, if supplied, is consulted before the
 * spend-threshold check: a flagged pattern (burn address, malformed
 * address, etc.) hard-denies the request, and a recipient explicitly marked
 * as not known escalates straight to secondary confirmation regardless of
 * amount.
 */
export function evaluateEscalation(
  request: EscalationRequest,
  options: MoneyEscalationOptions = DEFAULT_MONEY_ESCALATION_OPTIONS,
): EscalationDecision {
  if (request.category === 'money') {
    if (request.flaggedPattern) {
      return 'deny';
    }
    if (request.isKnownRecipient === false) {
      return 'require-secondary-confirmation';
    }
    if (request.amountWei !== undefined && request.amountWei > options.maxSpendWei) {
      return 'require-secondary-confirmation';
    }
    return 'require-confirmation';
  }

  return request.requiresDisclosure ? 'require-disclosure' : 'allow';
}

/**
 * Applies a human's confirmation to an escalation request and returns the
 * resulting decision. A `require-confirmation` decision only becomes `allow`
 * once `confirmed` is true; a `require-secondary-confirmation` decision only
 * becomes `allow` once both `confirmed` and `secondaryConfirmed` are true.
 * Anything that wasn't awaiting confirmation in the first place (e.g. a
 * `deny`) passes through unchanged — confirming can never override a deny.
 */
export function confirmEscalation(
  request: EscalationRequest,
  confirmation: EscalationConfirmation,
  options: MoneyEscalationOptions = DEFAULT_MONEY_ESCALATION_OPTIONS,
): EscalationDecision {
  const decision = evaluateEscalation(request, options);

  if (decision === 'require-confirmation') {
    return confirmation.confirmed ? 'allow' : decision;
  }

  if (decision === 'require-secondary-confirmation') {
    return confirmation.confirmed && confirmation.secondaryConfirmed ? 'allow' : decision;
  }

  return decision;
}
