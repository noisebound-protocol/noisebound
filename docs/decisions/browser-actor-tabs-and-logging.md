# Decision: browser actor-attributed tabs and the two-log architecture

**Status:** Proposed
**Date:** 2026-07-27
**Owner:** ryhoch

## Context

[`browser-tool-interface.md`](browser-tool-interface.md) scoped the three
browser tool schemas (`search_web`, `navigate`, `extract_page_data`) and
named two things it deliberately did not detail enough to commit to code:
actor-attributed tabs and the two-log system. Both have since gained partial
implementation in `packages/sigma-browser` — this doc is the follow-up pass
promised there, scoped to:

- **Actor-attributed tabs** — how the system distinguishes and labels
  user-driven vs. agent-driven tab activity in the UI. `packages/sigma-browser`
  already has a code-level distinction (`TabOrigin`); this doc looks at what
  that distinction actually covers and what it leaves open, particularly on
  the UI side, where nothing exists yet.
- **The two-log architecture** — a **gate log** for money-touching actions
  across all actors, and an **agent log** for σ-1's full activity, with
  `observe-loop`'s existing fact-store considered as the likely backing for
  the agent log. Neither log exists as a built thing today; this doc checks
  whether the pieces already in the repo (the fact-store, and an existing
  client-side escalation log in `apps/app`) are actually shaped like what a
  gate/agent log split would need.

Same field/gate/executor framing as the prior doc applies: the gate
(`evaluateEscalation`,
[`escalation.ts`](../../packages/sigma-core/src/escalation.ts)) is the single
point that decides whether an action surfaces to a human, regardless of
which actor triggered it. Actor-attributed tabs and the two logs are both
downstream of that gate, not alternate paths around it — a tab's origin
label changes what the gate requires (see Findings), and both logs are
proposed as records of what the gate decided, not decision points
themselves.

This doc makes no Tauri/webview commitments and no code changes. Where the
webview integration would determine the answer and that integration doesn't
exist yet, the question is listed under [Open questions](#open-questions)
rather than guessed at.

## Approach

Read what's actually implemented in `packages/sigma-browser` since the prior
doc, rather than starting the design fresh:

- **`tab.ts`** already encodes an actor distinction — not as a naming
  convention but as a branded type (`TAB_BRAND`, a module-private symbol)
  that a caller cannot forge by writing an object literal. This turned out
  to be more settled than expected; see Findings below for what it commits
  to and what it doesn't.
- **`evaluate.ts`** and **`disclosure.ts`** already consume that
  distinction — tab origin is not just a label sitting on the type, it
  drives the escalation outcome.
- For the two-log side, looked for anything in the repo already shaped like
  a log: `packages/observe-loop`'s fact-store
  ([`facts.ts`](../../packages/observe-loop/src/facts.ts),
  [`observe-loop.ts`](../../packages/observe-loop/src/observe-loop.ts)) and
  its `apps/app` persistence adapter
  ([`observeLoop/factStore.ts`](../../apps/app/lib/observeLoop/factStore.ts)),
  and `apps/app`'s existing escalation log
  ([`escalationLogStore.ts`](../../apps/app/lib/escalationLogStore.ts),
  [`types.ts:22-28`](../../apps/app/lib/types.ts)) — the closest thing that
  exists today to a "gate log." Both turned out to be a different shape than
  what a two-log architecture needs; see Findings.

## Findings

### Actor attribution today: a two-value, tab-scoped, unforgeable origin

`packages/sigma-browser/src/tab.ts` defines `TabOrigin` as exactly
`'agent-owned' | 'user-opened'`, and the only way to produce a `TabHandle`
is `tagAgentOwnedTab` / `tagUserOpenedTab`
([`tab.ts:38-51`](../../packages/sigma-browser/src/tab.ts)) — a caller
cannot construct one with a plain object because `TAB_BRAND` never leaves
the module. This is a real design commitment, not a placeholder:

- **`search_web` never carries a `TabHandle` at all**
  ([`types.ts:10-14`](../../packages/sigma-browser/src/types.ts)) — a search
  hits a search backend, not a loaded page, so it's categorically outside
  the actor-attribution question. Only `navigate` and `extract_page_data`
  have a tab to attribute.
- **Origin is not just a label — it drives the gate.**
  `requiresDisclosure` in `evaluate.ts` returns `true` the instant a
  `navigate`/`extract_page_data` request acts inside a
  `UserOpenedTabHandle`
  ([`evaluate.ts:15-20`](../../packages/sigma-browser/src/evaluate.ts)),
  and there is no field on either handle type that can suppress that
  ([`tab.ts:27-33`](../../packages/sigma-browser/src/tab.ts)). This is
  already the enforcement mechanism for "never silently act inside a tab
  the user already had open" — it doesn't need a UI to be correct, only to
  be visible.
- **`tagUserOpenedTab`'s doc comment names the actual gap:** it is "the
  sanctioned seam for a future host integration (e.g. a Tauri 'user opened
  this tab' event) to attribute a tab to the user"
  ([`tab.ts:42-48`](../../packages/sigma-browser/src/tab.ts)). Nothing
  calls it today except tests and stub code
  (`createStubBrowserAutomation`). The actual detection — how a real webview
  host notices "the user just opened/focused a tab σ-1 didn't open" and
  turns that into a call to this function — is unbuilt.
- **The public surface is exactly this and nothing more.** `sigma-browser`'s
  `index.ts` exports `TabOrigin`, `TabHandle`,
  `AgentOwnedTabHandle`/`UserOpenedTabHandle`, and the two tag functions —
  no logging export, no UI-facing labeling helper, no third actor value.
  There is currently no concept in the codebase of more than one distinct
  *agent* actor (e.g., multiple background jobs or sessions each needing
  their own attribution) — the type is binary because the product currently
  only has one agent (σ-1) and one human.

What this leaves genuinely open — labeling in a UI, whether origin can ever
change after a tab is tagged, and the Tauri event source — is in
[Open questions](#open-questions).

### The two-log system: neither piece in the repo is actually a log yet

**Gate log precedent: `apps/app/lib/escalationLogStore.ts`.** This is the
closest existing thing to "a gate log across all actors," and it's worth
being precise about its shape before assuming it's a starting point:

- It's a client-side `window.localStorage` read/write, guarded by
  `typeof window === 'undefined'`
  ([`escalationLogStore.ts:6-15`](../../apps/app/lib/escalationLogStore.ts))
  — there is no server-side or durable persistence today.
- It's a rolling window, not a full history: `appendEscalationLogEntry`
  unshifts and slices to `MAX_ENTRIES = 50`
  ([`escalationLogStore.ts:4,17-23`](../../apps/app/lib/escalationLogStore.ts)).
  Anything older than the last 50 entries is gone.
- `EscalationLogEntry` ([`types.ts:22-28`](../../apps/app/lib/types.ts)) has
  no actor field at all, and its `decision`/`outcome` fields aren't scoped
  to money — in current usage
  ([`NotificationsPageClient.tsx`](../../apps/app/components/notifications/NotificationsPageClient.tsx))
  it records both non-money disclosure outcomes and money confirmations
  through the same untyped path, driven from demo fixtures
  (`escalationFixtures.ts`, `notificationFixtures.ts`), not from real
  browser-tool or on-chain traffic.

So this store demonstrates a *shape* worth reusing (append, cap, read as a
list) but is not itself a money-scoped, durable, actor-aware gate log — it's
a demo-page log for a different, narrower purpose.

**Agent log candidate: `observe-loop`'s fact-store.** This is where the
"likely backing" framing needs a caveat. `ObservedFact`
([`facts.ts:8-14`](../../packages/observe-loop/src/facts.ts)) and
`ObserveLoop`'s in-memory `checks` map
([`observe-loop.ts:38-42,124-130`](../../packages/observe-loop/src/observe-loop.ts))
are a **last-value-per-check-id store, not an append-only log**: each
`register()` call claims one `checkId`
([`observe-loop.ts:77-79`](../../packages/observe-loop/src/observe-loop.ts)),
and every subsequent run overwrites that same entry's `value`/`lastCheckedAt`
in place. `getFact`/`listFacts`
([`observe-loop.ts:164-172`](../../packages/observe-loop/src/observe-loop.ts))
return current state, not history.

The `apps/app` persistence adapter,
[`ObserveFactStore`](../../apps/app/lib/observeLoop/factStore.ts), inherits
the same shape deliberately: `factEntryId(checkId)`
([`factStore.ts:28-30`](../../apps/app/lib/observeLoop/factStore.ts)) is
deterministic per check id, and `save()` calls `store.put()` at that same id
every time ([`factStore.ts:50-62`](../../apps/app/lib/observeLoop/factStore.ts))
— each save overwrites the prior one. This is exactly right for its actual
job (persisting a check's current value across process restarts) and would
be wrong for an agent log, which needs every action to survive, not just
the latest one per key.

The underlying primitive it's built on, `MemoryStore`
([`store.ts:8-15`](../../packages/memory-store/src/store.ts)), is more
capable than the `ObserveFactStore` adapter currently uses: `query()` takes
a `MemoryQuery` with `ids`, `createdAfter`/`createdBefore`,
`updatedAfter`/`updatedBefore`, and `limit`
([`types.ts:35-42`](../../packages/memory-store/src/types.ts)) — enough to
back a genuine append-only, time-range-queryable log *if* each logged event
gets its own unique entry id instead of being written at a fixed
per-check-id key. Nothing in the repo does this today. So "observe-loop's
fact-store" is better described as: the storage layer underneath it
(`MemoryStore`/`FilesystemStore`, encrypted at rest) is a plausible
backing for the agent log, but the fact-store adapter built on top of it
today is the wrong access pattern (keyed snapshot, not append) and a new
adapter — not a reuse of `ObserveFactStore` as-is — would be needed.

## Decision

Nothing in this doc is adopted as final — see Open questions — but three
things follow directly from code already in the repo and are treated as
settled rather than reopened:

1. **Actor attribution stays binary at the tab level:** `'agent-owned' |
   'user-opened'`, exactly as `tab.ts` already defines it. This doc found
   no case in the current architecture for a third origin value or for
   attributing a tab to a specific *user identity* (as opposed to "the
   user") — there's one human and one agent today.
2. **Tab origin continues to be the sole input to the disclosure trigger**
   for `navigate`/`extract_page_data` — no new field is proposed that could
   let a `UserOpenedTabHandle` skip disclosure, consistent with `tab.ts`'s
   existing design intent.
3. **`ObserveFactStore` (as it exists today) is not the agent log.** Any
   agent-log implementation either needs a new adapter over `MemoryStore`
   that mints a unique entry id per logged action (not per check id), or a
   different backing store entirely. This doc does not pick between those —
   see below — but it rules out pointing the agent log at the existing
   keyed adapter unmodified.

## Open questions

- **UI labeling for actor-attributed tabs.** No tab-bar, tab-strip, or
  browser-panel component exists anywhere in `apps/app` today (checked —
  there is no `Tab`-named component). Whether agent-owned and user-opened
  tabs render in the same strip with a badge/color distinction, in visually
  separate regions, or some other treatment is undesigned.
- **Can a tab's origin ever change after it's tagged?** `tab.ts`'s current
  design fixes `origin` at tag time with no transition path. If a user
  clicks into and starts driving a tab σ-1 opened, does it stay
  `agent-owned` forever, or is there a re-tagging event? Not decided, and
  not something the current type can express without a new API.
- **The actual Tauri/webview event source.** `tagUserOpenedTab`'s doc
  comment names this as its intended caller, but no Tauri integration code
  exists in the repo (only Playwright, which drives the app's own UI for QA
  in `qa/playwright-mcp`, not σ-1's browsing — same gap the prior doc
  flagged and still true). How a real webview host detects "the user
  opened/focused a tab" and whether that's even a reliable signal in a
  multi-tab Tauri webview is undetermined.
- **Gate log: schema, scope, and durability.** Is "money-touching" a filter
  on escalation category (`category === 'money'` only), or does it also
  include the foreground-gate-promotion case from the prior doc (a
  browsing session that leads to a money-shaped proposal)? Does it need an
  actor field added to something like `EscalationLogEntry`, and does it
  need to move off client-side `localStorage` (today's 50-entry rolling
  cache) to a durable, server-side store to actually serve as an audit
  trail "across all actors"? Not decided.
- **Agent log: scope and backing.** Does σ-1's "full activity" mean every
  browser tool call (`search_web`/`navigate`/`extract_page_data`) plus every
  other σ-1 action (observe-loop checks, notifications triggered), or is it
  scoped to browsing only for now? And per the Findings above, does it get
  built as a new adapter over the existing `MemoryStore`/`FilesystemStore`
  primitive (encrypted at rest, consistent with how facts are already
  stored), or some other store entirely? Not decided.
- **Overlap between the two logs.** When a money-touching action originates
  from a browsing session (the foreground-gate-promotion case), does it get
  written once to the gate log only, or to both the gate log and the agent
  log as part of σ-1's full trail? Not decided — affects whether the agent
  log is a superset of the gate log or a disjoint record.

## Follow-ups

- [ ] Design the tab-bar/browser-panel UI treatment for actor-attributed
      tabs once the Tauri webview integration (tracked in
      [`browser-tool-interface.md`](browser-tool-interface.md)'s open
      questions) has an owner.
- [ ] Decide whether `TabOrigin` needs a transition path (re-tagging) before
      any UI ships that could let a user take over an agent-owned tab.
- [ ] Scope the gate log's schema (actor field, money-only vs.
      promotion-inclusive filter) and pick a durable store before building
      it — `escalationLogStore.ts`'s rolling client-side cache is not
      sufficient as-is for an audit-grade gate log.
- [ ] Design a genuine append-only log adapter over `MemoryStore` (unique
      entry id per event, using `query()`'s `createdAfter`/`createdBefore`/
      `limit`) for the agent log, rather than extending `ObserveFactStore`,
      which is architecturally a keyed snapshot store.
- [ ] Resolve the gate-log/agent-log overlap question before either is
      built, since it changes both schemas.
