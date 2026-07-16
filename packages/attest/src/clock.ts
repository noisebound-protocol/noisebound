/**
 * Source of real wall-clock time. Attestation freshness checks must never
 * call `Date.now()` or `new Date()` directly — they depend on an injected
 * {@link Clock} so that token expiry and staleness can be tested
 * deterministically without waiting on real time.
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
