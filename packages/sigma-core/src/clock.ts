/**
 * Source of real wall-clock time. Policy logic must never call `Date.now()`
 * or `new Date()` directly — it depends on an injected {@link Clock} so that
 * every event carries a real timestamp and elapsed time is computed by
 * arithmetic on those timestamps, not estimated.
 */
export interface Clock {
  now(): Date;
}

/** Production {@link Clock} backed by the real system clock. */
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

/** Milliseconds elapsed between `since` and the clock's current time. */
export function elapsedMs(clock: Clock, since: Date): number {
  return clock.now().getTime() - since.getTime();
}
