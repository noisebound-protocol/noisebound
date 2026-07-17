import { elapsedMs, type Clock } from '@noisebound/sigma-core';

/**
 * A single fact being tracked by an {@link ObserveLoop} check: the last value
 * observed, when it was observed (per the injected {@link Clock}), and how
 * often it is expected to be refreshed.
 */
export interface ObservedFact<TValue = unknown> {
  readonly id: string;
  readonly description: string;
  readonly value: TValue;
  readonly lastCheckedAt: Date;
  readonly checkIntervalMs: number;
}

/** Result of a staleness check: whether a fact is stale, and its exact age. */
export interface StalenessResult {
  readonly isStale: boolean;
  readonly ageMs: number;
}

/**
 * Determines whether an {@link ObservedFact} is stale by computing its age
 * via arithmetic against the injected {@link Clock} — never estimated.
 */
export function isFactStale(
  fact: ObservedFact,
  clock: Clock,
  maxAgeMs: number,
): StalenessResult {
  const ageMs = elapsedMs(clock, fact.lastCheckedAt);
  return { isStale: ageMs > maxAgeMs, ageMs };
}
