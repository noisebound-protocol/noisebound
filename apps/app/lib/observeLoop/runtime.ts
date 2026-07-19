import { SystemClock, type Clock, type NotificationEvent } from '@noisebound/sigma-core';
import { ObserveLoop, type CheckDefinition, type Scheduler } from '@noisebound/observe-loop';
import type { ObserveFactStore } from './factStore';

/**
 * Wraps a check's `run` so every successful execution is persisted through
 * `factStore` before the value is handed back to {@link ObserveLoop}. This is
 * the generic memory-store adapter: individual checks stay unaware that
 * their state survives process restarts — persistence is bolted on here,
 * once, for any {@link CheckDefinition}.
 */
function withPersistence<TValue>(
  definition: CheckDefinition<TValue>,
  factStore: ObserveFactStore,
): CheckDefinition<TValue> {
  return {
    ...definition,
    run: async (clock) => {
      const value = await definition.run(clock);
      await factStore.save({
        id: definition.id,
        description: definition.description,
        value,
        lastCheckedAt: clock.now(),
        checkIntervalMs: definition.checkIntervalMs,
      });
      return value;
    },
  };
}

export interface BuildObserveLoopOptions {
  readonly factStore: ObserveFactStore;
  readonly checks: readonly CheckDefinition[];
  readonly clock?: Clock;
  readonly scheduler?: Scheduler;
  readonly onEvent?: (event: NotificationEvent) => void;
  readonly onError?: (checkId: string, error: unknown) => void;
}

/**
 * Builds a fully-wired {@link ObserveLoop}: each check's last persisted value
 * (if any) seeds its `initialValue`, so a restarted process resumes from
 * where it left off instead of re-seeding from each check's static default.
 * Does not call `start()` — callers decide when the scheduled ticking begins.
 */
export async function buildObserveLoop(options: BuildObserveLoopOptions): Promise<ObserveLoop> {
  const clock = options.clock ?? new SystemClock();
  const loop = new ObserveLoop({
    clock,
    ...(options.scheduler ? { scheduler: options.scheduler } : {}),
    ...(options.onEvent ? { onEvent: options.onEvent } : {}),
    ...(options.onError ? { onError: options.onError } : {}),
  });

  for (const definition of options.checks) {
    const persisted = await options.factStore.load(definition.id);
    loop.register(
      withPersistence(
        persisted ? { ...definition, initialValue: persisted.value } : definition,
        options.factStore,
      ),
    );
  }

  return loop;
}
