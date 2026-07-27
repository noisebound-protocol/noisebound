import type { Clock } from '@noisebound/sigma-core';
import { evaluateBrowserAction } from './evaluate.js';
import type { BrowserAutomation } from './automation.js';
import type { TabHandle } from './tab.js';
import type {
  BrowserToolRequest,
  BrowserToolResult,
  ExtractPageDataRequest,
  NavigateRequest,
  SearchWebRequest,
} from './types.js';

export interface BrowserToolExecutedOutcome {
  readonly status: 'executed';
  readonly requestId: string;
  readonly result: BrowserToolResult;
}

/**
 * evaluateBrowserAction forced require-disclosure and no confirmation has
 * been supplied yet — automation was never touched. `disclosure` is the
 * human-readable prompt to show; the only way past this is
 * runConfirmedBrowserToolRequest with an explicit confirmation.
 */
export interface BrowserToolAwaitingDisclosureOutcome {
  readonly status: 'awaiting-disclosure';
  readonly requestId: string;
  readonly disclosure: string;
}

/**
 * A human was shown the disclosure and chose to stay private instead of
 * confirming — automation was never touched.
 */
export interface BrowserToolDeclinedOutcome {
  readonly status: 'declined';
  readonly requestId: string;
  readonly disclosure: string;
}

export type BrowserToolOutcome =
  | BrowserToolExecutedOutcome
  | BrowserToolAwaitingDisclosureOutcome
  | BrowserToolDeclinedOutcome;

/** A human's response to a `BrowserToolAwaitingDisclosureOutcome`. */
export interface BrowserToolConfirmation {
  readonly confirmed: boolean;
}

async function resolveTab(requestTab: TabHandle | undefined, automation: BrowserAutomation): Promise<TabHandle> {
  return requestTab ?? automation.openAgentOwnedTab();
}

async function runSearch(
  request: SearchWebRequest,
  automation: BrowserAutomation,
  clock: Clock,
): Promise<BrowserToolResult> {
  const raw = await automation.search(request.query, request.maxResults);
  return {
    kind: 'search_web',
    query: request.query,
    results: raw.results,
    resultCount: raw.results.length,
    timestamp: clock.now().toISOString(),
  };
}

async function runNavigate(
  request: NavigateRequest,
  automation: BrowserAutomation,
  clock: Clock,
): Promise<BrowserToolResult> {
  const tab = await resolveTab(request.tab, automation);
  const raw = await automation.navigate(request.url, tab);
  return {
    kind: 'navigate',
    requestedUrl: request.url,
    finalUrl: raw.finalUrl,
    title: raw.title,
    status: raw.status,
    tab,
    timestamp: clock.now().toISOString(),
    ...(raw.reason !== undefined ? { reason: raw.reason } : {}),
  };
}

async function runExtract(
  request: ExtractPageDataRequest,
  automation: BrowserAutomation,
  clock: Clock,
): Promise<BrowserToolResult> {
  const tab = await resolveTab(request.tab, automation);
  const raw = await automation.extract(request.instruction, tab);
  return {
    kind: 'extract_page_data',
    sourceUrl: raw.sourceUrl,
    instruction: request.instruction,
    truncated: raw.truncated,
    sourceLength: raw.sourceLength,
    status: raw.status,
    summary: raw.summary,
    timestamp: clock.now().toISOString(),
    ...(raw.fields !== undefined ? { fields: raw.fields } : {}),
  };
}

async function execute(
  request: BrowserToolRequest,
  automation: BrowserAutomation,
  clock: Clock,
): Promise<BrowserToolExecutedOutcome> {
  let result: BrowserToolResult;
  switch (request.kind) {
    case 'search_web':
      result = await runSearch(request, automation, clock);
      break;
    case 'navigate':
      result = await runNavigate(request, automation, clock);
      break;
    case 'extract_page_data':
      result = await runExtract(request, automation, clock);
      break;
  }

  return { status: 'executed', requestId: request.id, result };
}

/**
 * Runs a browser tool request end to end: evaluates it against sigma-core's
 * escalation gate (evaluateBrowserAction, external-api category) and, if
 * that gate allows it outright, executes it against the injected
 * BrowserAutomation and stamps the result with the mandatory live-grounding
 * timestamp from clock — never left to individual automation
 * implementations to supply on their own.
 *
 * A required disclosure blocks: automation is never called here. This is
 * the encoding of "never silently act inside a tab the user already had
 * open" — search_web and navigate/extract_page_data against an
 * agent-owned tab never hit this path (evaluateBrowserAction always
 * allows them), so they stay exactly as background-autonomous and
 * non-blocking as before. Only a navigate/extract_page_data against a
 * UserOpenedTabHandle comes back as 'awaiting-disclosure'; the caller
 * must re-run the request through runConfirmedBrowserToolRequest with an
 * explicit human confirmation before it actually executes.
 */
export async function runBrowserToolRequest(
  request: BrowserToolRequest,
  automation: BrowserAutomation,
  clock: Clock,
): Promise<BrowserToolOutcome> {
  const evaluation = evaluateBrowserAction(request);

  if (evaluation.status === 'requires-disclosure') {
    return { status: 'awaiting-disclosure', requestId: request.id, disclosure: evaluation.summary };
  }

  return execute(request, automation, clock);
}

/**
 * Executes a browser tool request a human has already responded to,
 * mirroring sigma-execute's evaluateAction/executeConfirmedAction split:
 * evaluation (here, runBrowserToolRequest) never side-effects on a gated
 * path, and only this function — called with an explicit human
 * confirmation — is allowed to actually touch automation once a request
 * has been flagged require-disclosure.
 *
 * Note this does NOT delegate the unlock decision to sigma-core's
 * confirmEscalation: for a non-money 'external-api' category,
 * confirmEscalation always returns 'require-disclosure' regardless of the
 * confirmation supplied (see sigma-core's escalation.test.ts — it only
 * special-cases the money-only require-confirmation/
 * require-secondary-confirmation decisions), so calling it here would
 * permanently block every user-opened-tab navigate/extract. The
 * confirm/decline gate below is sigma-browser's own, driven purely by the
 * caller-supplied confirmation.
 *
 * Re-evaluates the request rather than trusting a stale evaluation, the
 * same way executeConfirmedAction re-validates the session capability
 * rather than trusting a stale confirmation payload. A request that was
 * never gated in the first place (search_web, or navigate/extract against
 * an agent-owned tab) executes unconditionally here too, so callers can
 * route every request through this single confirmed entry point safely.
 */
export async function runConfirmedBrowserToolRequest(
  request: BrowserToolRequest,
  confirmation: BrowserToolConfirmation,
  automation: BrowserAutomation,
  clock: Clock,
): Promise<BrowserToolOutcome> {
  const evaluation = evaluateBrowserAction(request);

  if (evaluation.status === 'requires-disclosure' && !confirmation.confirmed) {
    return { status: 'declined', requestId: request.id, disclosure: evaluation.summary };
  }

  return execute(request, automation, clock);
}
