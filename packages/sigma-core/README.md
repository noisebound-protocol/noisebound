# @noisebound/sigma-core

Deterministic execution-policy engine for Noisebound's σ-1 agent.

This package implements the pure decision logic that σ-1 uses to decide whether an action may proceed: whether a request that would leave the agent's private zone should be allowed, denied, or require disclosure, and whether a notification should be pushed to the user given a daily budget. All logic is deterministic and takes time as an injected `Clock` rather than reading the system clock directly, so decisions are reproducible and testable. Money-touching escalation requests are hard-denied by construction — `MoneyEscalationRequest` has no field that can flip the outcome.

## API

### Clock

- `interface Clock { now(): Date }` — source of wall-clock time. Policy logic depends on an injected clock instead of calling `Date.now()`/`new Date()` directly.
- `class SystemClock implements Clock` — production clock backed by the real system clock.
- `function elapsedMs(clock: Clock, since: Date): number` — milliseconds elapsed between `since` and the clock's current time.

### Escalation

- `type NonMoneyEscalationCategory = 'external-api' | 'data-sharing' | 'irreversible-action'` — categories of non-money escalations.
- `interface MoneyEscalationRequest { id, description, category: 'money', amountCents, currency }` — a request touching real money. Deliberately has no override/allow field of any kind.
- `interface NonMoneyEscalationRequest { id, description, category: NonMoneyEscalationCategory, requiresDisclosure }` — a request that does not touch real money.
- `type EscalationRequest = MoneyEscalationRequest | NonMoneyEscalationRequest`
- `type EscalationDecision = 'allow' | 'deny' | 'require-disclosure'`
- `function evaluateEscalation(request: EscalationRequest): EscalationDecision` — evaluates whether an action may leave the private zone. Any `money`-category request is hard-denied, unconditionally. Non-money requests are `require-disclosure` if `requiresDisclosure` is true, otherwise `allow`.

### Notifications

- `type NotificationTier = 'tier-1' | 'tier-2' | 'tier-3'` — `tier-1` always fires and doesn't count against the budget (inaction costs money); `tier-2` fires only if the daily budget allows (market moves / matched interests); `tier-3` never pushes, folded into a digest instead.
- `type NotificationEventKind = 'inaction-costs-money' | 'market-move-on-held-position' | 'matched-interest-opportunity' | 'digest-item'`
- `interface NotificationEvent { id, kind: NotificationEventKind }`
- `function classifyNotification(event: NotificationEvent): NotificationTier` — maps an event's kind to its push tier.
- `type NotificationOutcome = 'sent' | 'suppressed'`
- `interface NotificationBudgetOptions { dailyLimit: number, clock: Clock }` — `dailyLimit` is the max tier-2 pushes per day (intended range 3-5).
- `class NotificationBudget` — tracks the daily tier-2 notification budget, resetting automatically when the clock crosses into a new UTC day.
  - `remaining(): number` — tier-2 sends remaining today.
  - `get dailyCount(): number` — tier-2 sends used today.
  - `get suppressedCount(): number` — tier-3 events folded into the digest instead of pushed.
  - `recordSend(tier: NotificationTier): NotificationOutcome` — records a send attempt; tier-1 always sends, tier-3 always suppresses (and increments the suppressed count), tier-2 sends until the daily limit is reached then suppresses.

## Usage

```ts
import { evaluateEscalation, type MoneyEscalationRequest } from '@noisebound/sigma-core';

const request: MoneyEscalationRequest = {
  id: 'esc-1',
  description: 'Wire $500 to a vendor',
  category: 'money',
  amountCents: 50_000,
  currency: 'USD',
};

evaluateEscalation(request); // => 'deny', always, for any money request
```

```ts
import { NotificationBudget, SystemClock } from '@noisebound/sigma-core';

const budget = new NotificationBudget({ dailyLimit: 3, clock: new SystemClock() });

budget.recordSend('tier-2'); // 'sent' (while budget remains)
budget.recordSend('tier-1'); // 'sent' (never blocked, doesn't count against budget)
budget.recordSend('tier-3'); // 'suppressed' (folded into digest)
```
