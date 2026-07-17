import { describe, expect, it } from 'vitest';
import type { Clock } from '@noisebound/sigma-core';
import { isFactStale, type ObservedFact } from '../src/index.js';

class FakeClock implements Clock {
  constructor(private current: Date) {}

  now(): Date {
    return this.current;
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

function makeFact(lastCheckedAt: Date, checkIntervalMs = 60_000): ObservedFact<number> {
  return {
    id: 'fact-1',
    description: 'ETH/USD price',
    value: 3000,
    lastCheckedAt,
    checkIntervalMs,
  };
}

describe('isFactStale', () => {
  it('computes age via arithmetic on the injected clock, not estimation', () => {
    const start = new Date('2026-01-01T00:00:00.000Z');
    const clock = new FakeClock(start);
    const fact = makeFact(start);

    clock.advance(45_000);

    const result = isFactStale(fact, clock, 60_000);

    expect(result.ageMs).toBe(45_000);
    expect(result.isStale).toBe(false);
  });

  it('flags a fact as stale once its age exceeds maxAgeMs', () => {
    const start = new Date('2026-01-01T00:00:00.000Z');
    const clock = new FakeClock(start);
    const fact = makeFact(start, 60_000);

    clock.advance(60_001);

    const result = isFactStale(fact, clock, 60_000);

    expect(result.ageMs).toBe(60_001);
    expect(result.isStale).toBe(true);
  });

  it('treats age exactly equal to maxAgeMs as not yet stale', () => {
    const start = new Date('2026-01-01T00:00:00.000Z');
    const clock = new FakeClock(start);
    const fact = makeFact(start, 60_000);

    clock.advance(60_000);

    const result = isFactStale(fact, clock, 60_000);

    expect(result.ageMs).toBe(60_000);
    expect(result.isStale).toBe(false);
  });

  it('reports zero age and not-stale immediately after a check', () => {
    const start = new Date('2026-01-01T00:00:00.000Z');
    const clock = new FakeClock(start);
    const fact = makeFact(start, 60_000);

    const result = isFactStale(fact, clock, 60_000);

    expect(result.ageMs).toBe(0);
    expect(result.isStale).toBe(false);
  });

  it('correctly flags a fact as stale well past its checkIntervalMs', () => {
    const start = new Date('2026-01-01T00:00:00.000Z');
    const clock = new FakeClock(start);
    const fact = makeFact(start, 30_000);

    clock.advance(10 * 60_000); // 10x the interval

    const result = isFactStale(fact, clock, fact.checkIntervalMs);

    expect(result.ageMs).toBe(600_000);
    expect(result.isStale).toBe(true);
  });
});
