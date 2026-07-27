# @noisebound/sigma-browser

σ-1's browser action environment: tool schemas and escalation wiring for
`search_web`, `navigate`, and `extract_page_data`. Implements the interface
designed in
[docs/decisions/browser-tool-interface.md](../../docs/decisions/browser-tool-interface.md) —
read that doc first for the reasoning behind the design choices below.

This package defines the tool interface and escalation wiring only. Real
browser/webview automation (a Tauri integration) does not exist yet — see
`BrowserAutomation` in `automation.ts` and the stub in `stubAutomation.ts`.

## Design in one paragraph

Every browser tool call is a non-money `'external-api'` escalation request,
routed through `@noisebound/sigma-core`'s existing `evaluateEscalation`
unmodified — the same category `CloudInferenceActionRequest` already uses
in `sigma-execute`. `search_web`, and `navigate`/`extract_page_data`
against an agent-owned tab, are background-autonomous by default (no human
confirmation, ever — that's the non-money branch of `evaluateEscalation`,
which never returns `require-confirmation`). The one hard rule this
package enforces at the type level: acting inside a tab the user already
had open always forces `require-disclosure`, with no field anywhere that
can suppress it — and, per `execute.ts`, that blocks execution until a
human explicitly confirms (`runConfirmedBrowserToolRequest`); "stay
private" never touches automation. A `TabHandle` can only be produced via
`tagAgentOwnedTab`/`tagUserOpenedTab` (or
`BrowserAutomation.openAgentOwnedTab`, which tags internally) — a caller
cannot forge one by writing a plain object literal, because the branding
symbol never leaves `tab.ts`.

Money actions (`send_native`, `issue_session_key`) are out of scope for
this package entirely — they still go through `sigma-execute`'s existing
money escalation, which always requires confirmation regardless of what
triggered it, including a background browsing session.

## Exports

### Tabs (`tab.ts`)

- `TabHandle` — `AgentOwnedTabHandle | UserOpenedTabHandle`, branded so
  neither can be constructed by hand.
- `tagAgentOwnedTab(tabId)` / `tagUserOpenedTab(tabId)` — the only ways to
  produce a `TabHandle` from a raw id.

### Requests/results (`types.ts`)

- `BrowserToolRequest` — `SearchWebRequest | NavigateRequest |
ExtractPageDataRequest`. `search_web` carries no `tab` (it never acts
  inside one); `navigate`/`extract_page_data` carry an optional `tab` —
  omit it to have the tool spin up a fresh agent-owned tab.
- `BrowserToolResult` — `SearchWebResult | NavigateResult |
ExtractPageDataResult`. Every variant has a mandatory ISO-8601
  `timestamp` (σ-1's live-grounding requirement). `ExtractPageDataResult`
  is a bounded/summarized extraction — `summary`/`fields` sized to the
  request's `instruction`, never raw page text — with `truncated`/
  `sourceLength` making the extraction budget visible.

### Model-facing schema (`toolSchema.ts`)

- `TOOL_SCHEMAS` — OpenAI function-calling shape for `search_web`,
  `navigate`, `extract_page_data`, matching `types.ts`'s request fields.

### Agent tool-call conversion (`agentToolCall.ts`)

- `fromAgentToolCall(call: AgentToolCall, context: ToolCallContext):
BrowserToolRequest` — converts a raw model tool call into the trusted
  request type, clamping `maxResults` into `[1, MAX_SEARCH_RESULTS]`.
  `context.tab`, not the model, decides which tab (if any) a
  navigate/extract call acts inside.

### Escalation (`evaluate.ts`, `disclosure.ts`)

- `evaluateBrowserAction(request): BrowserEscalationOutcome` — `{ status:
'allowed' }` or `{ status: 'requires-disclosure', summary }`. A required
  disclosure blocks execution — see `execute.ts`.
- `buildDisclosureSummary(request): string` — the human-readable text shown
  for a required disclosure.

### Automation (`automation.ts`, `stubAutomation.ts`)

- `BrowserAutomation` — transport-agnostic interface: `openAgentOwnedTab`,
  `search`, `navigate`, `extract`. **No real implementation exists yet** —
  see the `REAL INTEGRATION POINT` comment in `automation.ts` for what a
  production (Tauri webview) implementation will need to do.
- `createStubBrowserAutomation(fixtures?)` — deterministic, in-memory
  implementation for tests and local development, keyed by exact
  query/url/instruction match against supplied fixtures.

### Orchestration (`execute.ts`)

- `runBrowserToolRequest(request, automation, clock): Promise<BrowserToolOutcome>`
  — evaluates the request against the escalation gate and, if allowed,
  runs it against `automation` and stamps the mandatory timestamp from
  `clock`, returning `{ status: 'executed', requestId, result }`. A
  navigate/extract_page_data call against a `UserOpenedTabHandle` never
  touches `automation` here — it comes back as
  `{ status: 'awaiting-disclosure', requestId, disclosure }` instead.
- `runConfirmedBrowserToolRequest(request, confirmation, automation, clock): Promise<BrowserToolOutcome>`
  — the only way to execute a request that came back `awaiting-disclosure`.
  Given `{ confirmed: true }` it executes for real (`'executed'`); given
  `{ confirmed: false }` ("stay private") it returns `{ status: 'declined',
  requestId, disclosure }` without ever calling `automation`. Requests that
  were never gated in the first place execute unconditionally here too, so
  callers can safely route every request through this single entry point.

## Usage

```ts
import {
  fromAgentToolCall,
  runBrowserToolRequest,
  createStubBrowserAutomation,
  tagUserOpenedTab,
} from '@noisebound/sigma-browser';
import { SystemClock } from '@noisebound/sigma-core';

const clock = new SystemClock();
const automation = createStubBrowserAutomation(); // placeholder until Tauri integration lands

const request = fromAgentToolCall(
  { kind: 'navigate', url: 'https://example.com' },
  { id: 'req-1', description: 'Check example.com' },
);

const outcome = await runBrowserToolRequest(request, automation, clock);
// outcome.status === 'executed' -> outcome.result.timestamp is present.
// outcome.status === 'awaiting-disclosure' -> automation was never called;
// re-run through runConfirmedBrowserToolRequest with a human's confirmed/
// stay-private response to get either 'executed' or 'declined'.
```
