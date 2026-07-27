import { tagAgentOwnedTab } from './tab.js';
import type { TabHandle } from './tab.js';
import type { BrowserAutomation, RawExtractResult, RawNavigateResult, RawSearchResult } from './automation.js';

/**
 * PLACEHOLDER — pending the real Tauri integration point described in
 * automation.ts. This is a deterministic, in-memory BrowserAutomation: it
 * never opens a real browser, makes no network calls, and returns
 * canned/configurable responses. It exists so sigma-browser's escalation
 * wiring and tool orchestration (evaluate.ts/execute.ts) can be built and
 * tested against a real BrowserAutomation shape today, without depending on
 * webview automation that hasn't been built yet.
 *
 * Every response is keyed by exact input match (query / url / instruction)
 * against `fixtures`; anything not registered falls back to the
 * `defaults` below, which always succeed with empty-ish data. Tests should
 * register only the fixtures they care about rather than relying on the
 * fallback content.
 */
export interface StubAutomationFixtures {
  readonly search?: Record<string, RawSearchResult>;
  readonly navigate?: Record<string, RawNavigateResult>;
  readonly extract?: Record<string, RawExtractResult>;
}

let nextStubTabId = 0;

export function createStubBrowserAutomation(fixtures: StubAutomationFixtures = {}): BrowserAutomation {
  const searchFixtures = fixtures.search ?? {};
  const navigateFixtures = fixtures.navigate ?? {};
  const extractFixtures = fixtures.extract ?? {};

  return {
    async openAgentOwnedTab() {
      nextStubTabId += 1;
      return tagAgentOwnedTab(`stub-tab-${nextStubTabId}`);
    },

    async search(query: string): Promise<RawSearchResult> {
      return searchFixtures[query] ?? { results: [] };
    },

    async navigate(url: string, tab: TabHandle): Promise<RawNavigateResult> {
      void tab;
      return (
        navigateFixtures[url] ?? {
          finalUrl: url,
          title: '',
          status: 'loaded',
        }
      );
    },

    async extract(instruction: string, tab: TabHandle): Promise<RawExtractResult> {
      void tab;
      return (
        extractFixtures[instruction] ?? {
          sourceUrl: '',
          summary: '',
          truncated: false,
          sourceLength: 0,
          status: 'ok',
        }
      );
    },
  };
}
