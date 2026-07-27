import type { AgentOwnedTabHandle, TabHandle } from './tab.js';

export interface RawSearchResult {
  readonly results: readonly {
    readonly title: string;
    readonly url: string;
    readonly snippet: string;
  }[];
}

export interface RawNavigateResult {
  readonly finalUrl: string;
  readonly title: string;
  readonly status: 'loaded' | 'blocked' | 'error';
  readonly reason?: string;
}

export interface RawExtractResult {
  readonly sourceUrl: string;
  readonly summary: string;
  readonly fields?: Record<string, string>;
  readonly truncated: boolean;
  readonly sourceLength: number;
  readonly status: 'ok' | 'refused';
}

/**
 * The actual browser control surface execute.ts runs tool requests against.
 * Deliberately transport-agnostic, the same way sigma-execute's
 * OnChainExecutor decouples evaluate/execute from any one signing backend —
 * see stubAutomation.ts for the only implementation that exists today.
 *
 * REAL INTEGRATION POINT: in production this drives a real Tauri webview
 * (or a pool of them), with `openAgentOwnedTab` opening a genuinely new
 * webview tab and `navigate`/`extract` operating on it via Tauri's
 * webview-control APIs. That integration does not exist yet — this
 * interface is the seam it will be built against, not a description of
 * anything currently running.
 */
export interface BrowserAutomation {
  /** Opens a brand-new tab that σ-1 itself owns. Never returns a handle to a tab the user already had open. */
  openAgentOwnedTab(): Promise<AgentOwnedTabHandle>;
  search(query: string, maxResults: number): Promise<RawSearchResult>;
  navigate(url: string, tab: TabHandle): Promise<RawNavigateResult>;
  extract(instruction: string, tab: TabHandle): Promise<RawExtractResult>;
}
