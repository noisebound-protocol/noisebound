import { evaluateEscalation } from '@noisebound/sigma-core';
import type { EscalationDecision, NonMoneyEscalationRequest } from '@noisebound/sigma-core';
import { buildDisclosureSummary } from './disclosure.js';
import type { BrowserToolRequest } from './types.js';

/**
 * Whether acting on this request requires disclosure. This is computed, not
 * a caller-supplied flag — there is no argument on any browser tool
 * (toolSchema.ts) or field on BrowserToolRequest that can set this
 * directly. search_web never touches a tab, so it is always background-safe.
 * navigate/extract_page_data force disclosure the instant they act inside a
 * UserOpenedTabHandle — this is the encoding of the doc's hard rule: never
 * silently act inside a tab the user already had open.
 */
function requiresDisclosure(request: BrowserToolRequest): boolean {
  if (request.kind === 'search_web') {
    return false;
  }
  return request.tab?.origin === 'user-opened';
}

function toEscalationRequest(request: BrowserToolRequest): NonMoneyEscalationRequest {
  return {
    category: 'external-api',
    id: request.id,
    description: request.description,
    requiresDisclosure: requiresDisclosure(request),
  };
}

export type BrowserEscalationOutcome =
  | { readonly status: 'allowed' }
  | { readonly status: 'requires-disclosure'; readonly summary: string };

/**
 * Routes a browser tool request through sigma-core's existing escalation
 * gate, reusing the 'external-api' non-money category exactly as
 * CloudInferenceActionRequest already does in sigma-execute — no new
 * category, no change to sigma-core's evaluateEscalation. For a
 * NonMoneyEscalationRequest, evaluateEscalation only ever returns 'allow' or
 * 'require-disclosure' (see sigma-core/src/escalation.ts's non-money
 * branch); the money-shaped decisions below are unreachable in practice
 * because this package never constructs a MoneyEscalationRequest, and are
 * treated as an invariant violation rather than silently handled.
 *
 * A required disclosure blocks execution: execute.ts's
 * runBrowserToolRequest never touches automation for a require-disclosure
 * result, and only runConfirmedBrowserToolRequest — given an explicit human
 * confirmation — is allowed to. search_web and navigate/extract_page_data
 * against an agent-owned tab are unaffected: evaluateEscalation only ever
 * returns require-disclosure here because of requiresDisclosure(request)
 * above, which is false for both of those, so they always come back
 * 'allowed' and stay background-autonomous, same as before.
 */
export function evaluateBrowserAction(request: BrowserToolRequest): BrowserEscalationOutcome {
  const decision: EscalationDecision = evaluateEscalation(toEscalationRequest(request));

  switch (decision) {
    case 'allow':
      return { status: 'allowed' };
    case 'require-disclosure':
      return { status: 'requires-disclosure', summary: buildDisclosureSummary(request) };
    case 'deny':
    case 'require-confirmation':
    case 'require-secondary-confirmation':
      throw new Error(
        `evaluateEscalation returned a money-shaped decision ('${decision}') for a non-money ` +
          "'external-api' request. sigma-browser never constructs a MoneyEscalationRequest, so this " +
          'should be unreachable — treating it as an invariant violation rather than silently allowing it.',
      );
  }
}
