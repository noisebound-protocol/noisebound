# Decision: conversational command bar for σ-1

**Status:** Proposed
**Date:** 2026-07-28
**Owner:** ryhoch

## Context

`apps/app` has zero natural-language interface to σ-1 today.
[`ActionTriggerForm.tsx`](../../apps/app/components/actions/ActionTriggerForm.tsx)
is deliberately structured — a recipient-address field validated against
`RECIPIENT_PATTERN` and a decimal-ETH amount field, with a comment noting
`'send' as const` is "the only action kind this form can build today." There
is no free-text input anywhere in `apps/app`, and no code path from a typed
sentence to a tool call.

Meanwhile `packages/sigma-tune` has been training σ-1 (a LoRA adapter on
Qwen3-30B-A3B, per
[`sigma1-base-model.md`](sigma1-base-model.md)) specifically to parse
natural language into the tool calls defined in
[`sigma-tune/src/toolSchema.ts`](../../packages/sigma-tune/src/toolSchema.ts):
`send_native`, `issue_session_key`, `query_balance`,
`evaluate_escalation_response`, `search_web`. A grep across `apps/app` for
any reference to `sigma-tune`, a tool schema, or an inference call turns up
nothing — the model being trained has no UI surface that would ever call it.

This doc scopes a command-bar style input (not a scrolling chat thread) that
takes NL text, sends it to σ-1, and routes any resulting tool call through
existing confirmation machinery. It does not implement anything — no code
changes accompany this doc.

## Approach

Before designing new confirmation UI, read every place `apps/app` already
gates an action behind human confirmation, to find what should be reused
rather than rebuilt.

### Two confirmation surfaces already exist, and they are not equivalent

**1. `ActionOutcomeDialog` — the real, execution-wired path.**
[`ActionTriggerForm`](../../apps/app/components/actions/ActionTriggerForm.tsx)
builds a real `ActionRequest`, submits it through the server action
[`evaluateSendActionTrigger`](../../apps/app/app/actions/actionTrigger.ts),
which calls
[`lib/actionTrigger.ts`](../../apps/app/lib/actionTrigger.ts)'s
`evaluateActionRequest` — `sigma-execute`'s real `evaluateAction`, wired to a
real `SystemClock` and the app's persisted recipient history. The resulting
`ExecutionOutcome` (`denied` / `awaiting-confirmation` /
`requires-secondary-confirmation` / `executed` / `execution-failed`) is
rendered by
[`ActionOutcomeDialog`](../../apps/app/components/actions/ActionOutcomeDialog.tsx),
whose `onConfirm` calls
[`executeOnChainMoneyAction`](../../apps/app/app/actions/onChainExecution.ts)
against a real session capability. This is the only dialog in the app
actually wired to money moving.

**2. `EscalationDialog` — a lower-level demo path, not wired to execution.**
[`EscalationDialog`](../../apps/app/components/escalation/EscalationDialog.tsx)
takes a raw `EscalationRequest` and calls `evaluateEscalation` (`sigma-core`)
directly. In the app today it is only driven by
`ESCALATION_SCENARIOS` fixtures in
[`NotificationsPageClient.tsx`](../../apps/app/components/notifications/NotificationsPageClient.tsx)
— its `onConfirm` just appends a log entry; nothing actually executes.

Both are rendered from the same `NotificationsPageClient.tsx`, conditionally
in JSX (`{activeAction ? <ActionOutcomeDialog .../> : null}`), which is the
existing pattern a command bar's own "currently pending action" state should
follow.

### The model→tool-call→execution seam already exists in `sigma-execute`, unused

[`sigma-execute/src/agentAction.ts`](../../packages/sigma-execute/src/agentAction.ts)
already defines exactly the conversion a command bar needs:
`fromAgentMoneyAction` turns a model-shaped `AgentMoneyActionRequest`
(`recipient`, `amount` as a decimal ETH string, `asset`) into the trusted
`OnChainMoneyActionRequest` sigma-execute's real `evaluateAction` consumes —
performing the ETH→wei conversion in code via `ethToWei`, per the
`sigma1-base-model.md` finding that models cannot be trusted with that
arithmetic. `evaluateAgentAction` wraps that conversion and the real
`evaluateAction` call in one step. **Nothing in the repo currently calls
either function.** They were built ahead of any caller existing.

The same shape exists on the browser side:
[`sigma-browser/src/agentToolCall.ts`](../../packages/sigma-browser/src/agentToolCall.ts)'s
`fromAgentToolCall` converts a raw `search_web` / `navigate` /
`extract_page_data` model call into a trusted `BrowserToolRequest`, and
[`evaluate.ts`](../../packages/sigma-browser/src/evaluate.ts)'s
`evaluateBrowserAction` routes it through `sigma-core`'s existing
`external-api` non-money category. Also unused by any caller today.

### `issue_session_key` has no equivalent seam, and no gate at all

[`SessionsPageClient.tsx`](../../apps/app/components/session/SessionsPageClient.tsx)
issues a session key directly via `IssueSessionKeyForm` — there is no
`ActionOutcomeDialog`/`EscalationDialog` in that flow today, and no
`fromAgentSessionKeyAction`-equivalent conversion function exists anywhere
in `sigma-execute` or `pqc-wallet`, unlike `send_native`'s
`fromAgentMoneyAction`. A command bar that hands the model's
`issue_session_key` output straight to `pqc-wallet`'s
`issueSessionCapability` would be adding a confirmation gate that does not
exist for this action kind even in the structured UI today. This is a real
gap, not a detail to paper over — see Open questions.

## Findings

### Where this lives in the component tree

[`AppShell.tsx`](../../apps/app/components/ui/AppShell.tsx) renders nav +
`PrivateZoneIndicator` + `<main>{children}</main>` and wraps every page
(`dashboard`, `sessions`, `notifications`, `feedback`). A command bar is a
cross-page input — unlike `ActionTriggerForm`, which is page-scoped
(currently mounted only inside `NotificationsPageClient`) — so it belongs in
`AppShell` itself, rendered as a sibling of `{children}`, not injected
per-page. Concretely: a new `apps/app/components/command/CommandBar.tsx`,
mounted from `AppShell.tsx`.

It would own the same shape of state `NotificationsPageClient.tsx` already
uses for `activeAction`: input text, an in-flight flag, a bounded log of
recent tool calls/responses (bounded — not a scrolling chat thread, per
scope), and whichever of `ActionOutcomeDialog` / an inline read-only
response it is currently showing. No new dialog component is needed to hold
that state; the existing conditional-render pattern is sufficient.

Left open: whether `AppShell`-level state is sufficient, or whether a
command-bar-triggered action needs to notify page-level state (e.g.
`DashboardClient`'s balance fetch, so a σ-1-initiated send is reflected
without a manual refresh) via a context/provider. Not resolved here — no
such cross-page notification mechanism exists in the app today for any
action, including the structured `ActionTriggerForm` path.

### Tool-call routing, if this were built today

| Tool call | Route |
|---|---|
| `send_native` | Model output → `fromAgentMoneyAction`/`evaluateAgentAction` (`sigma-execute/agentAction.ts`, unused today) → `ExecutionOutcome` → **reuse `ActionOutcomeDialog`** (the execution-wired dialog, not `EscalationDialog`) → confirm → `executeOnChainMoneyAction`. |
| `query_balance` | Read-only; `sigma-core` never gates a read. Render inline in the command bar's own response area — no dialog. |
| `search_web` | Read-only; same as above, and matches `sigma-browser`'s `evaluateBrowserAction` always returning `allowed` for `search_web`. |
| `issue_session_key` | **No existing seam or gate to reuse** (see Findings above). Needs its own design pass before this tool can be wired up at all — flagged as an open question, not designed here. |
| `evaluate_escalation_response` | Unclear this tool is reachable from a single command-bar prompt at all — see Open questions. |

No new confirmation UI is proposed for any of these. Where no existing
seam/gate covers a tool call (`issue_session_key`), the command bar should
refuse to act on that tool call rather than the doc inventing one here.

### Model-calling boundary: no inference endpoint exists yet

Does `apps/app` call an inference endpoint today? No — confirmed by grep,
nothing in `apps/app` references `sigma-tune`, a tool schema, or any
chat-completions call.

Does one exist anywhere in the repo? **No production serving endpoint
exists.** What exists:

- `sigma-tune/training/train.py` produces a LoRA adapter written to
  `training/output/final/` (gitignored). `training/README.md` says the
  adapter should be checked "against a served checkpoint" but does not say
  how that checkpoint gets served — no Ollama Modelfile, vLLM config, or
  equivalent is checked in.
- The only code in the repo that actually calls an OpenAI-compatible
  chat-completions endpoint is
  [`packages/model-eval/src/runner.ts`](../../packages/model-eval/src/runner.ts)
  — an eval-harness HTTP client, not a serving layer. It defaults to
  `http://localhost:11434/v1` (Ollama) and model `qwen3:30b-a3b` (the base
  model, not the fine-tuned adapter), configurable via
  `MODEL_EVAL_BASE_URL` / `MODEL_EVAL_MODEL` / `MODEL_EVAL_API_KEY` env
  vars. It lives inside `model-eval`, which `apps/app` does not depend on,
  and it's built to be invoked from a CLI script, not called safely from a
  Next.js server action (no per-request auth boundary, no app-facing
  wrapper).

So: a command bar needs an inference-calling boundary that does not exist
yet, and this doc does not invent one. Genuinely open, not a detail:

- Where the fine-tuned checkpoint is actually hosted for `apps/app` to
  reach — a local Ollama-style process on the user's machine (consistent
  with the self-host promise `sigma1-base-model.md` is built around), a
  private cloud endpoint, or something else.
- If it's ever a cloud endpoint rather than fully local, whether the
  inference call itself becomes a `CloudInferenceActionRequest` (the shape
  already exists in `sigma-execute/types.ts`, built for TEE-attested,
  blind-pay-authorized cloud calls) requiring its own
  escalation/disclosure pass *before* the tool call it produces is even
  evaluated — i.e., two possible escalation layers stacking, not one.
- The actual request/response contract an `apps/app` server action would
  call — analogous to how `lib/actionTrigger.ts` wraps `sigma-execute`, but
  for inference rather than execution. `model-eval/runner.ts`'s client is
  not this; it would need to be built or extracted.

### Browser actions: same input surface, once automation exists

[`browser-tool-interface.md`](browser-tool-interface.md) already decided
that a money-shaped tool call reached via background browsing must break to
the same foreground gate as a direct request (Decision #4,
"foreground-gate promotion"), and left open exactly which layer detects
that and triggers it — no session concept spanning multiple tool calls
exists anywhere in the codebase yet, per that doc.

Given that, once real browser automation exists (currently blocked — commit
`f3065bb`, "Tauri automation blocked - infra doesn't exist yet"), a σ-1
browsing session that lands on a `send_native` or
`issue_session_key` proposal should hand off into the *same*
command-bar-owned pending-action state this doc describes for directly
typed requests — not a separate browser-specific confirmation surface. A
background-triggered send and a typed "send 0.01 ETH to bob.eth" should
produce an identical `ActionOutcomeDialog`. This can't be designed further
than that intent here, since the session-dispatch question
`browser-tool-interface.md` left open is a precondition for it, not
something this doc can resolve.

## Decision

1. The command bar is a single-line NL input, not a chat thread, mounted in
   `AppShell.tsx` as a sibling of `{children}` so it is present on every
   route rather than page-scoped like `ActionTriggerForm` is today.
2. `send_native` tool calls route through the existing, already-built
   `fromAgentMoneyAction` / `evaluateAgentAction` seam in
   `sigma-execute/agentAction.ts`, and their resulting `ExecutionOutcome`
   is rendered with the existing `ActionOutcomeDialog` — the
   execution-wired dialog, not `EscalationDialog`, which is demo-only
   today.
3. `query_balance` and `search_web` render inline in the command bar's own
   response area; no dialog, since `sigma-core` never gates a read.
4. No new confirmation/escalation UI component is built for this feature.
   If a tool call has no existing trusted-conversion seam and no existing
   gate (`issue_session_key`, today), the command bar declines to act on
   it rather than inventing an ad hoc path — that gap gets its own design
   pass first.
5. The inference-calling boundary (where the model is served, how
   `apps/app` reaches it) is explicitly **not decided** by this doc — see
   Open questions.

## Open questions

- **Where is σ-1 actually served for `apps/app` to call?** No serving
  step exists anywhere in the repo today — `model-eval/runner.ts` is an
  eval CLI client pointed at whatever `MODEL_EVAL_BASE_URL` is set to, not
  a production endpoint.
- **Local-only or is a cloud fallback in scope?** If cloud, the inference
  call itself likely needs `CloudInferenceActionRequest`-shaped
  attestation/disclosure treatment before the tool call it returns is even
  evaluated — a second escalation layer stacked on top of the tool call's
  own.
- **`issue_session_key`'s confirmation path is undesigned.** No
  `fromAgentMoneyAction`-equivalent conversion exists, and the structured
  UI (`IssueSessionKeyForm`) issues directly today with no escalation gate
  at all to model this on.
- **Is `evaluate_escalation_response` reachable from a single command-bar
  prompt?** `ActionOutcomeDialog` already surfaces confirm/decline directly
  to the human without the model mediating; it's unclear what would ever
  cause σ-1 to emit this tool call inside a command-bar interaction rather
  than the UI just doing that job. May only matter for a future multi-turn
  surface, not this one.
- **Does a command-bar action need to notify page-level state** (e.g.
  `DashboardClient`'s balance fetch) once confirmed, or is a manual
  page refresh acceptable for now? No cross-page notification mechanism
  exists today for any action, including the structured
  `ActionTriggerForm` path.
- **Session-level dispatch for browser-triggered money proposals**
  (`browser-tool-interface.md`'s open question) is a precondition for the
  browser-routing intent stated above and is not resolved by this doc.

## Follow-ups

- [ ] Decide and document where the fine-tuned σ-1 checkpoint is served
      from, before any inference-calling code is written.
- [ ] Build an `apps/app`-facing inference client — not a reuse of
      `model-eval/runner.ts`, which is an eval-only CLI dependency.
- [ ] Design `issue_session_key`'s agent-facing conversion seam and
      confirmation gate (mirroring `fromAgentMoneyAction`), since none
      exists today.
- [ ] Resolve whether cloud-served inference needs its own
      `CloudInferenceActionRequest`-shaped escalation pass ahead of the
      tool call it produces.
- [ ] Once `browser-tool-interface.md`'s session-dispatch question is
      resolved, connect that dispatch layer's foreground-promoted
      proposals into this command bar's pending-action state.
- [ ] Build `CommandBar.tsx` and wire it into `AppShell.tsx`, reusing
      `ActionOutcomeDialog` for `send_native` and adding inline rendering
      for `query_balance`/`search_web` — scoped to only the tool calls
      that have an existing seam and gate.
