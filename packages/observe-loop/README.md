# @noisebound/observe-loop

Scheduled background-check loop for σ-1 Observe-mode. It runs a set of
registered checks, each on its own independent interval (not one shared
tick), persists each check's last-run timestamp and result as a
timestamped "fact," and reports staleness on demand via arithmetic against
an injected `Clock` — never estimated from wall-clock reads. A check that
throws is isolated: the error is reported through `onError` and every
other check keeps running on its own schedule.

Timing is fully injectable: checks are ticked through a `Scheduler`
abstraction (defaulting to real `setInterval`/`clearInterval`, swappable in
tests), and all timestamps come from the injected `Clock` (from
`@noisebound/sigma-core`), so behavior is deterministic under fake timers.

## API

### `ObserveLoop`

The main class. Runs registered checks on independent scheduled intervals
and persists their results.

- `new ObserveLoop(options: ObserveLoopOptions)` — construct with a
  required `clock`, and optional `scheduler`, `onError` (called when a
  check's `run` throws), and `onEvent` (called when a check's `onResult`
  produces a `NotificationEvent`).
- `register<TValue>(definition: CheckDefinition<TValue>): void` — registers
  a check and seeds its fact from `initialValue` and the current clock
  time. Throws if the check id is already registered. Schedules
  immediately if the loop is already running.
- `start(): void` — starts ticking every registered check on its own
  interval.
- `stop(): void` — stops all scheduled ticks; persisted facts remain
  queryable.
- `runNow(checkId: string): Promise<void>` — runs a registered check
  immediately, outside its schedule. Throws if the check id is unknown.
- `getFact(checkId: string): ObservedFact | undefined` — current persisted
  fact for a check.
- `listFacts(): ObservedFact[]` — all currently persisted facts.
- `getStaleness(checkId: string, maxAgeMs?: number): StalenessResult | undefined`
  — current staleness of a check's fact, computed on demand via clock
  arithmetic. Defaults `maxAgeMs` to the check's own `checkIntervalMs`.

### `CheckDefinition<TValue>`

Describes a single registered background check:

- `id: string`, `description: string`, `checkIntervalMs: number`,
  `initialValue: TValue`
- `run(clock: Clock): TValue | Promise<TValue>` — performs the check.
- `onResult?(previous: TValue, next: TValue, clock: Clock): NotificationEvent | undefined`
  — called after each successful run; return a `NotificationEvent` when the
  change matters, `undefined` otherwise. Classifying/pushing the event is
  left to `@noisebound/sigma-core`.

### `ObserveLoopOptions`

Constructor options for `ObserveLoop`: `clock: Clock`,
`scheduler?: Scheduler`, `onError?: (checkId: string, error: unknown) => void`,
`onEvent?: (event: NotificationEvent) => void`.

### `ObservedFact<TValue = unknown>`

A single tracked fact: `id`, `description`, `value`, `lastCheckedAt: Date`,
`checkIntervalMs: number`.

### `StalenessResult`

Result of a staleness check: `isStale: boolean`, `ageMs: number`.

### `isFactStale(fact: ObservedFact, clock: Clock, maxAgeMs: number): StalenessResult`

Determines whether a fact is stale by computing its age against the
injected `Clock`.

### `Scheduler`

Minimal timer abstraction (`setInterval`/`clearInterval`) that `ObserveLoop`
schedules checks through, so tests can substitute a fake implementation
instead of waiting on real timers.

### `RealScheduler`

Production `Scheduler` backed by the real `setInterval`/`clearInterval`.

## Usage

```ts
import { ObserveLoop, type CheckDefinition } from '@noisebound/observe-loop';
import type { Clock } from '@noisebound/sigma-core';

const loop = new ObserveLoop({
  clock,
  onError: (checkId, error) => console.error(`check "${checkId}" failed:`, error),
});

loop.register<number>({
  id: 'queue-depth',
  description: 'pending job count',
  checkIntervalMs: 5_000,
  initialValue: 0,
  run: async () => queryQueueDepth(),
  onResult: (previous, next) =>
    next > 100 && previous <= 100
      ? { kind: 'queue-backlog', message: `queue depth crossed 100 (${next})` }
      : undefined,
});

loop.start();

// On demand, without waiting for the next tick:
loop.getStaleness('queue-depth'); // { isStale, ageMs }
```
