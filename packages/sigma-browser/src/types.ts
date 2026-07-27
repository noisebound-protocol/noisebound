import type { TabHandle } from './tab.js';

export type BrowserToolKind = 'search_web' | 'navigate' | 'extract_page_data';

interface BaseToolRequest {
  readonly id: string;
  readonly description: string;
}

/**
 * Read-only web search. Never acts inside any tab — a search hits a search
 * backend, not a loaded page — so it carries no `TabHandle` and can never
 * trigger the user-opened-tab disclosure rule.
 */
export interface SearchWebRequest extends BaseToolRequest {
  readonly kind: 'search_web';
  readonly query: string;
  /** Already clamped into range by `fromAgentToolCall`; never taken as-is from a model. */
  readonly maxResults: number;
}

/**
 * Loads a URL. `tab` names which tab to navigate; omit it to have σ-1 open
 * a fresh agent-owned tab. Passing a `UserOpenedTabHandle` here is exactly
 * the case that forces `require-disclosure` in `evaluate.ts` — there is no
 * field on this request that can suppress that.
 */
export interface NavigateRequest extends BaseToolRequest {
  readonly kind: 'navigate';
  readonly url: string;
  readonly tab?: TabHandle;
}

/**
 * Extracts bounded, targeted data from an already-loaded page. `tab` names
 * which loaded page to read; omit it to read from a fresh agent-owned tab —
 * which, having nothing navigated into it yet, simply comes back empty.
 * This tool never falls back to reading whatever tab the user happens to
 * have focused; the only way it reads a user's tab is an explicit
 * `UserOpenedTabHandle`, which in turn forces disclosure.
 */
export interface ExtractPageDataRequest extends BaseToolRequest {
  readonly kind: 'extract_page_data';
  readonly instruction: string;
  readonly tab?: TabHandle;
}

export type BrowserToolRequest = SearchWebRequest | NavigateRequest | ExtractPageDataRequest;

// ---- Results ----
//
// Every result below carries a mandatory `timestamp` (ISO 8601 string) —
// σ-1's live-grounding requirement. A browsed fact without a timestamp is
// indistinguishable from a stale cache or the model's own training data,
// which defeats the reason these tools exist. `execute.ts` is the single
// place that stamps it, from an injected Clock — never left to individual
// automation implementations to supply on their own.

export interface SearchResultItem {
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
}

export interface SearchWebResult {
  readonly kind: 'search_web';
  readonly query: string;
  readonly results: readonly SearchResultItem[];
  readonly resultCount: number;
  readonly timestamp: string;
}

export type NavigateStatus = 'loaded' | 'blocked' | 'error';

export interface NavigateResult {
  readonly kind: 'navigate';
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly title: string;
  readonly status: NavigateStatus;
  /** Present when status != 'loaded'. */
  readonly reason?: string;
  /** The tab actually used — reuse this handle in a following extract_page_data call. */
  readonly tab: TabHandle;
  readonly timestamp: string;
}

export type ExtractStatus = 'ok' | 'refused';

/**
 * Bounded/targeted extraction result — never raw page HTML/text. `summary`
 * is sized to `instruction`, not to the page. `truncated`/`sourceLength`
 * make the extraction budget visible instead of silently dropping content.
 * `status: 'refused'` is reserved for pages this tool declines to read from
 * (e.g. a payment/signing flow) — see the decision doc's open question on
 * the exact refusal-detection rule, which is not implemented here.
 */
export interface ExtractPageDataResult {
  readonly kind: 'extract_page_data';
  readonly sourceUrl: string;
  readonly instruction: string;
  readonly summary: string;
  /** Structured key/value pairs when the instruction implies discrete fields; omitted for prose answers. */
  readonly fields?: Record<string, string>;
  readonly truncated: boolean;
  readonly sourceLength: number;
  readonly status: ExtractStatus;
  readonly timestamp: string;
}

export type BrowserToolResult = SearchWebResult | NavigateResult | ExtractPageDataResult;
