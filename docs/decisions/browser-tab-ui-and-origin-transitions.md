# Decision: actor-attributed tab labeling and origin transitions

**Status:** Proposed
**Date:** 2026-07-27
**Owner:** ryhoch

## Context

[`browser-actor-tabs-and-logging.md`](browser-actor-tabs-and-logging.md) left
five open questions. This doc resolves the two that are answerable without a
webview integration decision:

1. **UI labeling for actor-attributed tabs** — how a tab visually indicates
   `agent-owned` vs. `user-opened`, given no tab-bar component exists yet.
2. **Whether `TabOrigin` can transition after tagging** — can a user "claim"
   an agent-owned tab, or vice versa, and if so under what conditions.

The other three open questions from the prior doc — the Tauri event source,
and the gate-log and agent-log schema/durability questions — are **not**
addressed here. Those need real webview integration and storage decisions
this doc can't make; they stay open and are restated at the end.

This doc makes no code changes. It proposes a component shape and a type
change, both of which would need actual implementation as follow-up work.

## Approach

For the labeling question: rather than inventing a new visual vocabulary,
looked at what `apps/app` already uses to indicate actor/state distinctions
in the UI, since a tab-bar doesn't exist yet but comparable ambient-state
indicators do —
[`Badge`](../../apps/app/components/ui/Badge.tsx) (tone-based pill,
`neutral | accent | danger | warning | success`, optional `dot`) and
[`PrivateZoneIndicator`](../../apps/app/components/escalation/PrivateZoneIndicator.tsx)
(a persistent ambient state indicator with an active/inactive dot). The
proposal below reuses `Badge` rather than proposing a new component, because
the distinction it needs to carry — a two-value enum with a clear "this one
needs your attention" polarity — is exactly what `Badge`'s tone prop already
expresses elsewhere (`NetworkBadge` uses `tone="accent"` the same way).

For the transition question: re-read `tab.ts`'s actual constraints (the
`TAB_BRAND` symbol, the two tag functions, `evaluate.ts`'s
`requiresDisclosure`) to determine what a transition would have to do to the
type and the gate, rather than treating it as a pure UI question.

## Findings

### Labeling: a tab-bar doesn't exist, but the badge vocabulary to label one already does

`origin` is exactly `'agent-owned' | 'user-opened'`
([`tab.ts:16`](../../packages/sigma-browser/src/tab.ts)), and its only
behavioral consequence today is forcing disclosure for a `user-opened` tab
([`evaluate.ts:15-20`](../../packages/sigma-browser/src/evaluate.ts)). That
asymmetry should carry into the label: `agent-owned` is the default,
unremarkable case (σ-1 opened this, nothing to flag), while `user-opened` is
the one the user needs to be able to spot at a glance, because it's the one
that forces disclosure. The labeling design should make `user-opened` the
visually "louder" state, not treat the two as a neutral pair.

Concretely:

- **Reuse `Badge`, don't invent a new component.** `agent-owned` →
  `tone="neutral"` (or omitted, since `neutral` is the default) — same
  treatment as any other ambient, non-actionable label in the app.
  `user-opened` → `tone="accent"` with `dot`, mirroring `NetworkBadge`'s
  existing pattern of pairing `tone="accent"` with a dot for "this is
  network/context state worth noticing." This keeps the tab-bar consistent
  with the rest of the app's visual language instead of introducing a
  third way to indicate state.
- **Label text should name the actor, not just the origin value.** Not
  `agent-owned`/`user-opened` verbatim (implementation-detail language) but
  something like "σ-1" / "Your tab" — consistent with
  `buildDisclosureSummary`'s existing user-facing phrasing ("a tab you
  already had open",
  [`disclosure.ts:21,23`](../../packages/sigma-browser/src/disclosure.ts)),
  which already establishes second-person phrasing for the user-opened case
  in the one place this distinction currently reaches a human.
- **Placement: per-tab, in whatever tab-bar/strip eventually gets built**,
  not a single global indicator. `PrivateZoneIndicator` is a reasonable
  precedent for an ambient *single* state indicator, but tab origin is
  per-tab state, not app-wide state — one `PrivateZoneIndicator`-style badge
  can't represent "3 agent-owned tabs, 1 user-opened tab" at once. Each tab
  entry in the eventual tab-bar needs its own `Badge`, not a shared one.
- **This is a labeling proposal, not a component build.** No tab-bar exists
  to attach this to yet ([`browser-actor-tabs-and-logging.md`](browser-actor-tabs-and-logging.md)
  confirmed this — no `Tab`-named component anywhere in `apps/app`). This
  doc fixes what the label should say and how it should look whenever that
  component gets built; it does not build it.

### Transitions: not supported by the current type, and shouldn't be added without a policy for what happens to in-flight escalation state

`tab.ts`'s design is deliberately one-way: `origin` is fixed at construction
inside `BrandedTabHandle`
([`tab.ts:18-22`](../../packages/sigma-browser/src/tab.ts)), and the only
producers are `tagAgentOwnedTab` and `tagUserOpenedTab`
([`tab.ts:38,49`](../../packages/sigma-browser/src/tab.ts)) — there is no
`retagTab` or mutation path, and `origin` is `readonly`. Adding a transition
is possible but not free: it would need a new function (something like
`claimAgentOwnedTab(handle: AgentOwnedTabHandle): UserOpenedTabHandle`) that
produces a new branded handle, since the existing handles are immutable by
design and that immutability is load-bearing for the "can't forge a handle"
guarantee the module comment calls out.

Splitting the two transition directions, since they have different risk
profiles:

- **User claims an agent-owned tab (`agent-owned` → `user-opened`).** This
  is the direction worth supporting. If a user clicks into a tab σ-1 opened
  and starts driving it themselves, continuing to treat it as
  `agent-owned` — and therefore exempt from the disclosure trigger in
  `evaluate.ts:19` — is a false negative: `evaluateBrowserAction` would keep
  allowing σ-1 to act in that tab without disclosure, even though the user
  is now the one navigating it. That's the same "never silently act inside
  a tab the user already had open" hazard the current `user-opened` branch
  exists to prevent, just arriving after the fact instead of at open time.
  A `claimAgentOwnedTab` transition closes that gap and is strictly
  *more* conservative than today's behavior (it can only ever make future
  requests against that tab more likely to require disclosure, never less)
  — which is why this direction doesn't conflict with the prior doc's
  Decision #2 ("tab origin continues to be the sole input to the disclosure
  trigger... no new field is proposed that could let a `UserOpenedTabHandle`
  skip disclosure"). This adds a way to *become* user-opened, not a way to
  stop behaving like one.
- **Agent claims a user-opened tab (`user-opened` → `agent-owned`).** This
  direction should not be supported. It would let σ-1 (or a bug) launder a
  disclosure-requiring tab into the no-disclosure-required category, which
  is exactly the escape hatch `tab.ts`'s doc comment says doesn't exist by
  design ("Deliberately has no field that lets a caller mark it as
  low-risk or pre-disclosed,"
  [`tab.ts:29-31`](../../packages/sigma-browser/src/tab.ts)). Nothing in
  the current architecture calls for it, and it directly undermines the
  guarantee the prior doc treated as settled.
- **What "the user claims it" actually means is still underspecified, and
  that's a webview-integration question, not a type question.** The type
  change (`claimAgentOwnedTab`) is small and can be decided now. *When* to
  call it — on tab focus, on the first user-driven navigation, on an
  explicit user action — depends on what signal a real Tauri webview
  integration can actually detect, which is the same unresolved surface as
  `tagUserOpenedTab`'s "sanctioned seam for a future host integration" gap
  the prior doc already left open. This doc does not pick a trigger signal.
- **Escalation state during a transition is unresolved and deliberately left
  open.** If σ-1 has an in-flight or already-evaluated `navigate`/
  `extract_page_data` request against a tab at the moment it transitions,
  should that request be re-evaluated, or does the transition only affect
  requests issued after it? `evaluateBrowserAction` is called per-request,
  not held against tab state, so there's no existing re-evaluation hook to
  reuse. This is closer to an execution-flow question (`execute.ts`) than a
  tab-typing question and is out of scope here — flagged as a follow-up
  below rather than decided.

## Decision

1. **Tab labeling reuses `Badge`, not a new component.** `agent-owned` →
   `tone="neutral"` (default/unremarkable). `user-opened` → `tone="accent"`
   with `dot` (the state worth noticing), matching `NetworkBadge`'s existing
   pattern. Label text names the actor in user-facing language ("σ-1" /
   "Your tab"), not the raw `TabOrigin` value. This is a per-tab badge in
   whatever tab-bar component gets built, not a single global indicator.
2. **`TabOrigin` gains exactly one transition: `agent-owned` →
   `user-opened`**, via a new function in the shape of
   `claimAgentOwnedTab(handle: AgentOwnedTabHandle): UserOpenedTabHandle`,
   producing a fresh branded handle rather than mutating the existing one.
   **The reverse direction (`user-opened` → `agent-owned`) is explicitly
   rejected** — it would let a disclosure-requiring tab be laundered into
   the no-disclosure category, contradicting `tab.ts`'s existing design
   intent and the prior doc's Decision #2. Neither the trigger condition for
   calling `claimAgentOwnedTab` nor the handling of in-flight escalation
   state at transition time is decided here (see Findings) — both are
   follow-ups.

## Open questions

Carried forward unresolved from the prior doc — none of these are answered
by this doc, and none can be, without a webview integration decision:

- **The actual Tauri/webview event source.** Still no Tauri integration
  code in the repo. This also now gates the *trigger* for
  `claimAgentOwnedTab` (see Findings above) in addition to
  `tagUserOpenedTab`'s original gap — the two are the same unresolved
  signal-detection problem, not two separate ones.
- **Gate log: schema, scope, and durability.** Unchanged from the prior
  doc — not addressed here.
- **Agent log: scope and backing.** Unchanged from the prior doc — not
  addressed here.
- **Overlap between the two logs.** Unchanged from the prior doc — not
  addressed here.

New open question raised by this doc:

- **Escalation re-evaluation on transition.** When `claimAgentOwnedTab`
  fires, does any in-flight or already-evaluated request against that tab
  get re-evaluated, or does the transition only bind future requests? Not
  decided — see Findings.

## Follow-ups

- [ ] Build the tab-bar/browser-panel component and apply the `Badge`
      treatment decided here, once it has an owner (still blocked on the
      same Tauri webview integration the prior doc flagged).
- [ ] Implement `claimAgentOwnedTab` in `tab.ts` once a real trigger signal
      exists to call it from.
- [ ] Decide the escalation re-evaluation question above before
      `claimAgentOwnedTab` ships, since it affects `execute.ts`, not just
      `tab.ts`.
- [ ] Everything already tracked in
      [`browser-actor-tabs-and-logging.md`](browser-actor-tabs-and-logging.md)'s
      follow-ups for the gate log and agent log remains outstanding.
