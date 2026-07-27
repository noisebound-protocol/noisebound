import type { TabHandle } from './tab.js';
import type { BrowserToolRequest } from './types.js';

/** Raw model-produced tool call, matching toolSchema.ts's argument shapes exactly. */
export interface AgentSearchWebCall {
  readonly kind: 'search_web';
  readonly query: string;
  readonly maxResults?: number;
}

export interface AgentNavigateCall {
  readonly kind: 'navigate';
  readonly url: string;
}

export interface AgentExtractPageDataCall {
  readonly kind: 'extract_page_data';
  readonly instruction: string;
}

export type AgentToolCall = AgentSearchWebCall | AgentNavigateCall | AgentExtractPageDataCall;

/**
 * Everything the host adds to a raw model tool call to produce a trusted
 * request: an id/description for tracing, and (for navigate/extract_page_data
 * only) which tab to act inside. This is a host-side decision, never
 * something the model itself supplies — the model's tool-call arguments
 * (see toolSchema.ts) have no tab field at all. Omitting `tab` here is what
 * causes execute.ts to have the tool spin up a fresh agent-owned tab.
 */
export interface ToolCallContext {
  readonly id: string;
  readonly description: string;
  readonly tab?: TabHandle;
}

export const DEFAULT_SEARCH_MAX_RESULTS = 5;
export const MAX_SEARCH_RESULTS = 10;
const MIN_SEARCH_RESULTS = 1;

function clampMaxResults(maxResults: number | undefined): number {
  if (maxResults === undefined) {
    return DEFAULT_SEARCH_MAX_RESULTS;
  }
  return Math.min(Math.max(Math.trunc(maxResults), MIN_SEARCH_RESULTS), MAX_SEARCH_RESULTS);
}

/**
 * Converts a model-produced tool call into the trusted BrowserToolRequest
 * the rest of sigma-browser operates on. This is the one seam where a
 * model-supplied maxResults gets clamped into range — mirroring how
 * sigma-execute's fromAgentMoneyAction is the one seam where a
 * model-supplied amount gets converted to wei — so no other code needs to
 * re-validate it.
 */
export function fromAgentToolCall(call: AgentToolCall, context: ToolCallContext): BrowserToolRequest {
  switch (call.kind) {
    case 'search_web':
      return {
        kind: 'search_web',
        id: context.id,
        description: context.description,
        query: call.query,
        maxResults: clampMaxResults(call.maxResults),
      };
    case 'navigate':
      return {
        kind: 'navigate',
        id: context.id,
        description: context.description,
        url: call.url,
        ...(context.tab !== undefined ? { tab: context.tab } : {}),
      };
    case 'extract_page_data':
      return {
        kind: 'extract_page_data',
        id: context.id,
        description: context.description,
        instruction: call.instruction,
        ...(context.tab !== undefined ? { tab: context.tab } : {}),
      };
  }
}
