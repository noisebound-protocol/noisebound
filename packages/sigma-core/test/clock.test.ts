import { describe, expect, it } from 'vitest';
import { elapsedMs, type Clock } from '../src/index.js';

class FakeClock implements Clock {
  constructor(private current: Date) {}

  now(): Date {
    return this.current;
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

describe('Clock injection', () => {
  it('reports the injected time rather than the real wall clock', () => {
    const fixed = new Date('2026-01-01T00:00:00.000Z');
    const clock = new FakeClock(fixed);

    expect(clock.now()).toEqual(fixed);
  });

  it('computes elapsed time via arithmetic on injected timestamps', () => {
    const start = new Date('2026-01-01T00:00:00.000Z');
    const clock = new FakeClock(start);

    clock.advance(90_000);

    expect(elapsedMs(clock, start)).toBe(90_000);
  });

  it('reflects manual advances deterministically across multiple reads', () => {
    const clock = new FakeClock(new Date('2026-01-01T00:00:00.000Z'));
    const first = clock.now();

    clock.advance(1_000);
    const second = clock.now();

    expect(second.getTime() - first.getTime()).toBe(1_000);
  });
});
