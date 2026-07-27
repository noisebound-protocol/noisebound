# Decision: browser tool interface for σ-1

**Status:** Proposed
**Date:** 2026-07-26
**Owner:** ryhoch

## Context

σ-1 needs a browser as an action environment: a way to search the web,
load a page, and pull structured information off it, so its answers and
proposals can be grounded in what's actually on the web right now rather
than stale training data. This falls out of the field/gate/executor
architecture the product is built on:

- the **field** is where σ-1 observes and acts day-to-day — for browsing,
  that's a web page or search result, not on-chain state or a wallet.
- the **gate** is sigma-core's escalation policy
  ([`escalation.ts`](../../packages/sigma-core/src/escalation.ts)): the
  single point that decides whether an action needs a human in the loop
  before it proceeds.
- the **executor** is sigma-execute
  ([`evaluate.ts`](../../packages/sigma-execute/src/evaluate.ts),
  [`types.ts`](../../packages/sigma-execute/src/types.ts)): what actually
  carries out a gate-cleared action (on-chain signing, cloud-request
  authorization).

Two product constraints shape this scope:

- **Background-only autonomy for non-money actions.** σ-1 should be able
  to search, browse, and extract data on its own, unattended, without a
  human present for every page load — that's the whole point of giving it
  a browser instead of asking the user to paste content in.
- **Money actions always break to the foreground gate, regardless of
  actor.** If browsing (background, autonomous) turns up something that
  leads σ-1 to propose spending money or minting a new capability, that
  proposal must surface to the human in the foreground exactly the same
  way it would if the user had asked for it directly in chat. Being
  triggered by a background browsing session is not a lower-trust path
  and must not grant any exception from the money gate.

This doc scopes exactly three tools — `search_web`, `navigate`,
`extract_page_data` — and the interface/package questions around them.
It does not cover the Tauri webview integration, actor-attributed tabs,
or the two-log system in the detail that would let those be committed to
code; see [Open questions](#open-questions).

## Approach

Looked at the two closest precedents already in the repo before designing
anything new:

- **`packages/model-eval/src/toolSchema.ts`** is the existing pattern for
  a model-facing tool schema: OpenAI function-calling shape
  (`ToolSchema` / `ToolFunctionSchema` / `ToolParameterSchema`), each tool
  documented with why it can or can't skip the gate, argument types kept
  primitive (strings, not model-inferred bigints or dates). The browser
  tool schemas below follow the same shape and the same
  it's-not-invented-independently rule: they're written against what the
  executor and gate can actually consume, not against what reads nicely
  as a schema in isolation.
- **`packages/sigma-execute/src/confirmation.ts`** is the existing
  pattern for turning a full request into a short, bounded, human-facing
  string (`buildConfirmationSummary`) rather than passing raw request
  data through to a UI. `extract_page_data`'s bounded-extract design
  (below) is the same move applied to page content instead of a money
  request.

For the gate side: sigma-core's `NonMoneyEscalationCategory` already
includes `'external-api'`, and `evaluateEscalation` already resolves
non-money requests to `'allow'` (silent, background-safe) or
`'require-disclosure'` (surfaced, but per the type's name and its
`AwaitingConfirmationOutcome`-free path, not blocking) — as distinct from
every money request, which *always* resolves to `'require-confirmation'`
or `'require-secondary-confirmation'` and has no field that can loosen
that. That existing split is precisely the "background-only autonomy for
non-money, money always gates" behavior this doc needs — it doesn't
require a new escalation category or a new decision value, just browser
requests that map onto the existing `'external-api'` category the same
way `cloud-inference` already does.

## Findings

### The three tool schemas

All three share a mandatory `timestamp` field on their result (ISO 8601
string, e.g. `2026-07-26T14:03:00.000Z`) — not optional, not
best-effort. This is σ-1's live-grounding requirement: any browsed fact
it hands back to the model must carry the moment it was actually
observed, the same way every `ExecutionOutcome` in sigma-execute already
carries a `timestamp: Date` from an injected `Clock`
([`types.ts:70-127`](../../packages/sigma-execute/src/types.ts)). A
browser result without a timestamp is indistinguishable from a stale
cached page or the model's own training data, which defeats the reason
the tool exists.

**`search_web`**

```
name: search_web
description: >
  Search the web for a query and return a bounded list of results (title,
  URL, snippet). Read-only; never requires confirmation. Use this to find
  candidate pages before navigate/extract_page_data, not as a source of
  truth in itself — snippets are provider-supplied summaries, not
  verified page content.
parameters:
  query: string (required) — the search query, verbatim or lightly cleaned.
  maxResults: integer (optional, default 5, max 10) — caps result count;
    exists to bound context cost, not to be tuned per-query by the model.
required: [query]

result:
  query: string — the query actually run.
  results: array of { title: string, url: string, snippet: string }
  resultCount: integer
  timestamp: string (ISO 8601, mandatory) — when the search was executed.
```

**`navigate`**

```
name: navigate
description: >
  Load a URL in σ-1's browser session and report what loaded. Read-only;
  never requires confirmation on its own. Does not return page content —
  call extract_page_data afterward for that. Rejects (status: 'blocked')
  rather than loading a URL that is not http(s), to keep this tool from
  becoming a generic file/protocol handler.
parameters:
  url: string (required) — must be http(s); anything else is rejected,
    not attempted.
required: [url]

result:
  requestedUrl: string
  finalUrl: string — post-redirect URL actually loaded.
  title: string
  status: 'loaded' | 'blocked' | 'error'
  reason: string (present when status != 'loaded')
  timestamp: string (ISO 8601, mandatory)
```

**`extract_page_data`**

```
name: extract_page_data
description: >
  Pull bounded, targeted information from the currently loaded page.
  Never returns raw page HTML/text — see bounded-extract design below.
  Read-only; never requires confirmation on its own. If the page appears
  to be a payment, wallet-connect, or transaction-signing flow, this
  returns status: 'refused' instead of extracting — that determination
  belongs to the gate, not to this tool.
parameters:
  instruction: string (required) — what to look for (e.g. "the listed
    price and shipping estimate", "the repository's license"). Directs
    the bounded extraction; this tool does not accept an "extract
    everything" mode.
required: [instruction]

result:
  sourceUrl: string
  instruction: string — echoed back for traceability.
  summary: string — bounded extraction result (see below), sized to the
    instruction, not the page.
  fields: record<string, string> (optional) — structured key/value pairs
    when the instruction implies discrete fields (price, date, address);
    omitted when the answer is prose.
  truncated: boolean — true if the source page exceeded the extraction
    budget and content was cut.
  sourceLength: integer — character length of the page content considered,
    reported specifically so truncation is visible rather than silent.
  status: 'ok' | 'refused'
  timestamp: string (ISO 8601, mandatory)
```

### Bounding `extract_page_data`

Dumping raw page text into context is the failure mode this tool exists
to avoid — full HTML/DOM text is unbounded, mostly boilerplate, and would
blow past context budget on the first real-world page. The design:

1. `instruction` is required, not optional — there is no "just give me
   the whole page" mode. This mirrors `buildConfirmationSummary`
   ([`confirmation.ts`](../../packages/sigma-execute/src/confirmation.ts)),
   which builds a short targeted string from a full request rather than
   passing the request through.
2. Extraction runs against a readability-style main-content pass (strips
   nav/ads/boilerplate) before anything is handed to a
   summarization/field-extraction step scoped by `instruction` — the
   page is never handed to the calling model in raw form at any
   intermediate step.
3. The result is capped at a fixed character budget (a specific number
   is an implementation detail, not an interface commitment made here);
   `truncated` and `sourceLength` make the cap visible instead of
   silently dropping content, the same way sigma-execute always reports
   *why* an outcome is what it is rather than returning a bare status.

### Package boundary

**Recommendation: a new package, `packages/sigma-browser`, not an
extension of `sigma-execute`.**

`sigma-execute`'s own `package.json` description is explicit about its
scope — "routes a proposed action through escalation policy, human
confirmation, and real execution (on-chain signing or cloud-request
authorization)" — and its dependency list is entirely money/crypto
machinery: `pqc-wallet`, `networks`, `cloud-request`, `attest`,
`blind-pay`, `ethers`. A browser tool package needs an entirely different
dependency spine (webview control, HTML parsing/readability,
summarization) that has nothing to do with signing or attestation.
Folding it into `sigma-execute` would drag those dependencies into every
consumer that currently imports `sigma-execute` purely for its money
types and escalation wiring (`model-eval`, `sigma-tune`, `apps/app`'s
action-trigger path) — the same kind of scope creep the existing
packages elsewhere in the monorepo avoid (`observe-loop` for scheduled
checks, `attest` for attestation, `cloud-request` for the TEE payment
gate — each a narrow, single-purpose package, not a folder inside a
neighbor).

`sigma-browser` would depend on `@noisebound/sigma-core` — for the
`Clock` convention behind the mandatory `timestamp` field, and for the
`NonMoneyEscalationCategory` / `EscalationRequest` types used to map its
tool results onto the `'external-api'` category — and nothing from the
money/crypto side (no `pqc-wallet`, `attest`, `blind-pay`, `ethers`).

## Decision

1. Adopt the three tool schemas above (`search_web`, `navigate`,
   `extract_page_data`), each with a mandatory `timestamp` result field.
2. Build them in a new package, **`packages/sigma-browser`**, depending
   only on `sigma-core` — not as an extension of `sigma-execute`.
3. Browser tool results map onto sigma-core's existing
   `NonMoneyEscalationRequest` with `category: 'external-api'` — reusing
   the category `cloud-inference` already uses rather than introducing a
   new one — so background-only autonomy for browsing falls out of
   `evaluateEscalation`'s existing non-money path
   (`'allow'` / `'require-disclosure'`) with no new gate logic required.
4. **Foreground-gate promotion condition:** a browsing session — no
   matter how it was initiated, background cron or live chat — must
   break to the foreground money gate the moment the model's *next*
   proposed tool call is a money-shaped one: `send_native` (or any future
   on-chain-money `ActionRequest`) or `issue_session_key`. This is a
   property of the tool call being made, not of the browser tools
   themselves — `search_web` / `navigate` / `extract_page_data` never
   trigger it directly, since none of them is money-shaped. The existing
   gate already refuses to auto-execute any `MoneyEscalationRequest`
   regardless of caller
   ([`escalation.ts:83-117`](../../packages/sigma-core/src/escalation.ts));
   what's new here is only that a background browsing actor must not be
   treated as a different, lower-friction caller than a foreground chat
   actor when it hits that same gate. Exactly which dispatch layer
   detects "the next call is money-shaped, escalate the whole session to
   foreground" is not settled — see below.

## Open questions

The following are named in the product architecture but not detailed
enough in the current codebase to commit to specifics here, so this doc
states them as open rather than guessing:

- **Where does session-level promotion actually run?** Today,
  `apps/app/lib/actionTrigger.ts` calls `evaluateAction` per individual
  request; there's no existing concept of a *session* that spans
  multiple tool calls (browse, browse, then propose a send) and no
  component that watches a session's tool-call stream to decide "this
  session must now surface to foreground." Whether that dispatch logic
  belongs in `sigma-browser`, in `sigma-execute`, in `apps/app`, or in a
  not-yet-created orchestration layer above both is open.
- **Tauri webview integration.** No Tauri/webview control code exists in
  the repo yet (only Playwright, which drives the *app's own* UI for QA
  in `qa/playwright-mcp`, not σ-1's browsing). How `navigate` and
  `extract_page_data` actually control a real browser surface — one
  Tauri webview vs. a pool, headless vs. visible, how the human observes
  what σ-1 is browsing — is undetermined.
- **Actor-attributed tabs.** Referenced in the architecture as the
  mechanism that would let a tab/session carry which actor (background
  job vs. foreground user) opened it, which foreground-promotion
  presumably keys off. No schema or implementation for this exists yet.
- **Two-log system.** Referenced as part of how browsing activity is
  recorded, presumably split along a similar background/foreground or
  disclosed/undisclosed line as `evaluateEscalation`'s
  `'allow'`/`'require-disclosure'` split. Not detailed enough yet to say
  whether `search_web`/`navigate`/`extract_page_data` write to one log,
  both, or a log selected by the escalation decision.
- **Refusal boundary for `extract_page_data` on sensitive pages.** The
  schema above proposes a `status: 'refused'` escape hatch for
  payment/wallet-connect/signing pages so the tool doesn't extract
  content it shouldn't act on, but the actual detection rule (URL
  pattern? DOM heuristic? a call out to the same gate logic?) is not
  designed here and needs its own pass.

## Follow-ups

- [ ] Scaffold `packages/sigma-browser` (package.json, tsconfig, src
      layout) following the shape of `packages/observe-loop`.
- [ ] Resolve the session-dispatch open question above before writing
      any tool-execution code — the schemas in this doc don't depend on
      the answer, but the foreground-promotion behavior does.
- [ ] Pick and document the actual extraction character budget for
      `extract_page_data` once a real readability/summarization
      implementation is chosen.
- [ ] Design the `extract_page_data` refusal-detection rule for
      payment/signing pages.
