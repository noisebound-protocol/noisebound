import type { Clock, NotificationEvent } from '@noisebound/sigma-core';
import { isFactStale, type ObservedFact, type StalenessResult } from './facts.js';
import { RealScheduler, type Scheduler } from './scheduler.js';

/**
 * A single registered background check: what to run, how often, and how to
 * decide whether a new result matters enough to surface as a notification
 * event. `run` and `onResult` are given the same {@link Clock} the loop was
 * constructed with, so timestamps stay consistent with the rest of the
 * system rather than reading the wall clock directly.
 */
export interface CheckDefinition<TValue = unknown> {
  readonly id: string;
  readonly description: string;
  readonly checkIntervalMs: number;
  readonly initialValue: TValue;
  run(clock: Clock): TValue | Promise<TValue>;
  /**
   * Called after each successful run with the previous and next value.
   * Return a {@link NotificationEvent} when the change matters (e.g. a
   * threshold was crossed); return `undefined` otherwise. The event is
   * handed to `onEvent` as-is — classifying it and deciding whether it
   * actually gets pushed is `@noisebound/sigma-core`'s job, not this
   * package's.
   */
  onResult?(previous: TValue, next: TValue, clock: Clock): NotificationEvent | undefined;
}

export interface ObserveLoopOptions {
  readonly clock: Clock;
  readonly scheduler?: Scheduler;
  /** Called when a check's `run` throws. Must not itself throw. */
  readonly onError?: (checkId: string, error: unknown) => void;
  /** Called when a check's `onResult` produces a notification event. */
  readonly onEvent?: (event: NotificationEvent) => void;
}

interface CheckEntry {
  readonly definition: CheckDefinition;
  fact: ObservedFact;
  handle: unknown;
}

/**
 * Runs a set of registered checks on independent, genuinely scheduled
 * intervals (not one shared global tick), persists each check's last-run
 * timestamp and result, and can be queried for current staleness at any
 * time without waiting for the next scheduled run. A check that throws is
 * isolated — it is logged via `onError` and the rest of the loop keeps
 * running.
 */
export class ObserveLoop {
  private readonly clock: Clock;
  private readonly scheduler: Scheduler;
  private readonly onError: (checkId: string, error: unknown) => void;
  private readonly onEvent: (event: NotificationEvent) => void;
  private readonly checks = new Map<string, CheckEntry>();
  private running = false;

  constructor(options: ObserveLoopOptions) {
    this.clock = options.clock;
    this.scheduler = options.scheduler ?? new RealScheduler();
    this.onError =
      options.onError ??
      ((checkId, error): void => {
        console.error(`[observe-loop] check "${checkId}" failed:`, error);
      });
    this.onEvent = options.onEvent ?? ((): void => {});
  }

  /**
   * Registers a check and seeds its persisted fact from `initialValue` and
   * the current clock time. If the loop is already running, the check is
   * scheduled immediately.
   */
  register<TValue>(definition: CheckDefinition<TValue>): void {
    if (this.checks.has(definition.id)) {
      throw new Error(`observe-loop: check "${definition.id}" is already registered`);
    }

    const entry: CheckEntry = {
      definition: definition as CheckDefinition,
      fact: {
        id: definition.id,
        description: definition.description,
        value: definition.initialValue,
        lastCheckedAt: this.clock.now(),
        checkIntervalMs: definition.checkIntervalMs,
      },
      handle: undefined,
    };
    this.checks.set(definition.id, entry);

    if (this.running) {
      this.schedule(entry);
    }
  }

  /** Starts the scheduled loop: each registered check begins ticking on its own interval. */
  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;
    for (const entry of this.checks.values()) {
      this.schedule(entry);
    }
  }

  /** Stops all scheduled ticks. Persisted facts remain queryable. */
  stop(): void {
    if (!this.running) {
      return;
    }
    this.running = false;
    for (const entry of this.checks.values()) {
      if (entry.handle !== undefined) {
        this.scheduler.clearInterval(entry.handle);
        entry.handle = undefined;
      }
    }
  }

  private schedule(entry: CheckEntry): void {
    entry.handle = this.scheduler.setInterval(() => {
      void this.executeCheck(entry.definition.id);
    }, entry.definition.checkIntervalMs);
  }

  private async executeCheck(checkId: string): Promise<void> {
    const entry = this.checks.get(checkId);
    if (!entry) {
      return;
    }

    try {
      const previousValue = entry.fact.value;
      const nextValue = await entry.definition.run(this.clock);
      const now = this.clock.now();

      entry.fact = {
        ...entry.fact,
        value: nextValue,
        lastCheckedAt: now,
      };

      const event = entry.definition.onResult?.(previousValue, nextValue, this.clock);
      if (event) {
        this.onEvent(event);
      }
    } catch (error) {
      this.onError(checkId, error);
    }
  }

  /** Runs a registered check immediately, outside its schedule. Useful for tests and manual refresh. */
  async runNow(checkId: string): Promise<void> {
    if (!this.checks.has(checkId)) {
      throw new Error(`observe-loop: unknown check "${checkId}"`);
    }
    await this.executeCheck(checkId);
  }

  /** Current persisted fact for a check, or `undefined` if never registered. */
  getFact(checkId: string): ObservedFact | undefined {
    return this.checks.get(checkId)?.fact;
  }

  /** All currently persisted facts. */
  listFacts(): ObservedFact[] {
    return Array.from(this.checks.values(), (entry) => entry.fact);
  }

  /**
   * Current staleness of a check's fact, computed on demand via clock
   * arithmetic — does not require waiting for the next scheduled run.
   * Defaults `maxAgeMs` to the check's own `checkIntervalMs`.
   */
  getStaleness(checkId: string, maxAgeMs?: number): StalenessResult | undefined {
    const entry = this.checks.get(checkId);
    if (!entry) {
      return undefined;
    }
    return isFactStale(entry.fact, this.clock, maxAgeMs ?? entry.fact.checkIntervalMs);
  }
}
