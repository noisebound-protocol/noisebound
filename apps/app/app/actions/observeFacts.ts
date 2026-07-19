'use server';

import 'server-only';
import { getObserveLoop } from '../../lib/observeLoop/singleton';

/** Wire form of an ObservedFact — Date and unknown value made JSON-safe for the client boundary. */
export interface ObservedFactView {
  readonly id: string;
  readonly description: string;
  readonly value: string;
  readonly lastCheckedAt: string;
  readonly checkIntervalMs: number;
  readonly isStale: boolean;
  readonly ageMs: number;
}

/** Reads the background observe loop's current facts, for display or diagnostics. */
export async function getObserveFactsAction(): Promise<ObservedFactView[]> {
  const loop = await getObserveLoop();

  return loop.listFacts().map((fact) => {
    const staleness = loop.getStaleness(fact.id);
    return {
      id: fact.id,
      description: fact.description,
      value: typeof fact.value === 'string' ? fact.value : JSON.stringify(fact.value),
      lastCheckedAt: fact.lastCheckedAt.toISOString(),
      checkIntervalMs: fact.checkIntervalMs,
      isStale: staleness?.isStale ?? false,
      ageMs: staleness?.ageMs ?? 0,
    };
  });
}
