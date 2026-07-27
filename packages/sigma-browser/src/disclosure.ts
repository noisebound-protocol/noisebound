import type { BrowserToolRequest } from './types.js';

function tabSuffix(request: BrowserToolRequest, phrase: string): string {
  return request.kind !== 'search_web' && request.tab?.origin === 'user-opened' ? ` ${phrase}` : '';
}

/**
 * Builds the human-readable disclosure text shown when evaluateBrowserAction
 * forces require-disclosure. Mirrors sigma-execute's
 * buildConfirmationSummary: a short, bounded string built from the full
 * request, not the request itself passed through. Phrased as a
 * not-yet-happened action (present tense) rather than a past-tense notice —
 * execute.ts blocks on this text pending confirmation, so it is always shown
 * before the action runs, never after.
 */
export function buildDisclosureSummary(request: BrowserToolRequest): string {
  switch (request.kind) {
    case 'search_web':
      return `Search the web for "${request.query}"`;
    case 'navigate':
      return `Navigate to ${request.url}${tabSuffix(request, 'inside a tab you already had open')}`;
    case 'extract_page_data':
      return `Extract page data ("${request.instruction}")${tabSuffix(request, 'from a tab you already had open')}`;
  }
}
