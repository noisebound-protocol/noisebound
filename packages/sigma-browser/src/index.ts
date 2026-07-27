export type { TabOrigin, TabHandle, AgentOwnedTabHandle, UserOpenedTabHandle } from './tab.js';
export { tagAgentOwnedTab, tagUserOpenedTab } from './tab.js';

export type {
  BrowserToolKind,
  SearchWebRequest,
  NavigateRequest,
  ExtractPageDataRequest,
  BrowserToolRequest,
  SearchResultItem,
  SearchWebResult,
  NavigateStatus,
  NavigateResult,
  ExtractStatus,
  ExtractPageDataResult,
  BrowserToolResult,
} from './types.js';

export type { ToolParameterSchema, ToolFunctionSchema, ToolSchema } from './toolSchema.js';
export { TOOL_SCHEMAS } from './toolSchema.js';

export type { AgentToolCall, AgentSearchWebCall, AgentNavigateCall, AgentExtractPageDataCall, ToolCallContext } from './agentToolCall.js';
export { fromAgentToolCall, DEFAULT_SEARCH_MAX_RESULTS, MAX_SEARCH_RESULTS } from './agentToolCall.js';

export { buildDisclosureSummary } from './disclosure.js';

export type { BrowserEscalationOutcome } from './evaluate.js';
export { evaluateBrowserAction } from './evaluate.js';

export type { BrowserAutomation, RawSearchResult, RawNavigateResult, RawExtractResult } from './automation.js';

export type { StubAutomationFixtures } from './stubAutomation.js';
export { createStubBrowserAutomation } from './stubAutomation.js';

export type {
  BrowserToolOutcome,
  BrowserToolExecutedOutcome,
  BrowserToolAwaitingDisclosureOutcome,
  BrowserToolDeclinedOutcome,
  BrowserToolConfirmation,
} from './execute.js';
export { runBrowserToolRequest, runConfirmedBrowserToolRequest } from './execute.js';
