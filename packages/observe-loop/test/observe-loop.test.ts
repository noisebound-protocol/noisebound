import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { classifyNotification, NotificationBudget, type Clock, type NotificationEvent } from '@noisebound/sigma-core';
import { ObserveLoop, type CheckDefinition } from '../src/index.js';

class FakeClock implements Clock {
  constructor(private current: Date) {}

  now(): Date {
    return this.current;
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

/** Advances both vitest's fake timers and the injected FakeClock together, then flushes microtasks. */
async function tick(clock: FakeClock, ms: number): Promise<void> {
  clock.advance(ms);
  await vi.advanceTimersByTimeAsync(ms);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ObserveLoop scheduling', () => {
  it('runs each registered check on its own independent interval, not one shared tick', async () => {
    const clock = new FakeClock(new Date('2026-01-01T00:00:00.000Z'));
    const loop = new ObserveLoop({ clock });

    let fastRuns = 0;
    let slowRuns = 0;

    loop.register<number>({
      id: 'fast',
      description: 'fast check',
      checkIntervalMs: 1_000,
      initialValue: 0,
      run: () => {
        fastRuns += 1;
        return fastRuns;
      },
    });

    loop.register<number>({
      id: 'slow',
      description: 'slow check',
      checkIntervalMs: 5_000,
      initialValue: 0,
      run: () => {
        slowRuns += 1;
        return slowRuns;
      },
    });

    loop.start();

    await tick(clock, 5_000);

    expect(fastRuns).toBe(5);
    expect(slowRuns).toBe(1);
  });

  it('isolates a failing check so other checks keep running on schedule', async () => {
    const clock = new FakeClock(new Date('2026-01-01T00:00:00.000Z'));
    const errors: Array<{ checkId: string; error: unknown }> = [];
    const loop = new ObserveLoop({
      clock,
      onError: (checkId, error) => {
        errors.push({ checkId, error });
      },
    });

    let healthyRuns = 0;

    loop.register<number>({
      id: 'broken',
      description: 'always throws',
      checkIntervalMs: 1_000,
      initialValue: 0,
      run: () => {
        throw new Error('boom');
      },
    });

    loop.register<number>({
      id: 'healthy',
      description: 'always succeeds',
      checkIntervalMs: 1_000,
      initialValue: 0,
      run: () => {
        healthyRuns += 1;
        return healthyRuns;
      },
    });

    loop.start();

    await tick(clock, 3_000);

    expect(healthyRuns).toBe(3);
    expect(errors).toHaveLength(3);
    expect(errors.every((e) => e.checkId === 'broken')).toBe(true);
  });

  it('reports staleness on demand between scheduled runs without waiting for the next tick', async () => {
    const clock = new FakeClock(new Date('2026-01-01T00:00:00.000Z'));
    const loop = new ObserveLoop({ clock });

    loop.register<number>({
      id: 'price',
      description: 'price check',
      checkIntervalMs: 10_000,
      initialValue: 100,
      run: () => 100,
    });

    loop.start();

    await tick(clock, 4_000);

    const staleness = loop.getStaleness('price');
    expect(staleness).toBeDefined();
    expect(staleness?.ageMs).toBe(4_000);
    expect(staleness?.isStale).toBe(false);
  });

  it('flags a fact as stale once queried well past its checkIntervalMs', async () => {
    const clock = new FakeClock(new Date('2026-01-01T00:00:00.000Z'));
    const loop = new ObserveLoop({ clock });

    loop.register<number>({
      id: 'price',
      description: 'price check',
      checkIntervalMs: 1_000,
      initialValue: 100,
      run: () => 100,
    });

    loop.start();

    // Stop after one run, then let real time pass without further ticks.
    await tick(clock, 1_000);
    loop.stop();
    clock.advance(30_000);

    const staleness = loop.getStaleness('price');
    expect(staleness?.ageMs).toBe(30_000);
    expect(staleness?.isStale).toBe(true);
  });

  it('persists last-run timestamp and result per check, queryable via getFact/listFacts', async () => {
    const clock = new FakeClock(new Date('2026-01-01T00:00:00.000Z'));
    const loop = new ObserveLoop({ clock });

    loop.register<number>({
      id: 'price',
      description: 'price check',
      checkIntervalMs: 1_000,
      initialValue: 100,
      run: () => 250,
    });

    loop.start();
    await tick(clock, 1_000);

    const fact = loop.getFact('price');
    expect(fact?.value).toBe(250);
    expect(fact?.lastCheckedAt).toEqual(clock.now());
    expect(loop.listFacts()).toHaveLength(1);
  });

  it('produces a sigma-core-compatible NotificationEvent when a check result crosses a threshold', async () => {
    const clock = new FakeClock(new Date('2026-01-01T00:00:00.000Z'));
    const events: NotificationEvent[] = [];
    const loop = new ObserveLoop({
      clock,
      onEvent: (event) => events.push(event),
    });

    const definition: CheckDefinition<number> = {
      id: 'eth-price',
      description: 'ETH/USD price',
      checkIntervalMs: 1_000,
      initialValue: 3_000,
      run: () => 3_600, // crosses an assumed 3,500 alert threshold
      onResult: (previous, next) => {
        const crossed = previous < 3_500 && next >= 3_500;
        if (!crossed) {
          return undefined;
        }
        return { id: 'eth-price-alert', kind: 'market-move-on-held-position' };
      },
    };

    loop.register(definition);
    loop.start();

    await tick(clock, 1_000);

    expect(events).toHaveLength(1);
    expect(classifyNotification(events[0]!)).toBe('tier-2');

    const budget = new NotificationBudget({ dailyLimit: 3, clock });
    expect(budget.recordSend(classifyNotification(events[0]!))).toBe('sent');
  });

  it('does not schedule further runs after stop()', async () => {
    const clock = new FakeClock(new Date('2026-01-01T00:00:00.000Z'));
    const loop = new ObserveLoop({ clock });

    let runs = 0;
    loop.register<number>({
      id: 'price',
      description: 'price check',
      checkIntervalMs: 1_000,
      initialValue: 0,
      run: () => {
        runs += 1;
        return runs;
      },
    });

    loop.start();
    await tick(clock, 2_000);
    expect(runs).toBe(2);

    loop.stop();
    await tick(clock, 5_000);
    expect(runs).toBe(2);
  });
});
