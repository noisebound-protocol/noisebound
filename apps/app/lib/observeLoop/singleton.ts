import type { ObserveLoop } from '@noisebound/observe-loop';
import { createFunderBalanceCheck } from './checks';
import { createObserveFactStore } from './factStore';
import { buildObserveLoop } from './runtime';

/**
 * Stashed on globalThis so the loop (and its running interval timers) is
 * created exactly once per server process — surviving Next.js dev-mode
 * module hot-reloads — rather than once per request or chat turn, same
 * pattern as lib/registry.ts's revocation registry.
 */
const globalForObserveLoop = globalThis as unknown as {
  __noisebound_observeLoopPromise?: Promise<ObserveLoop>;
};

async function startProductionObserveLoop(): Promise<ObserveLoop> {
  const factStore = createObserveFactStore();
  const loop = await buildObserveLoop({
    factStore,
    checks: [createFunderBalanceCheck()],
    onError: (checkId, error) => {
      console.error(`[observe-loop] check "${checkId}" failed:`, error);
    },
  });
  loop.start();
  return loop;
}

/** Lazily starts (once per process) and returns the app's background observe loop. */
export function getObserveLoop(): Promise<ObserveLoop> {
  globalForObserveLoop.__noisebound_observeLoopPromise ??= startProductionObserveLoop();
  return globalForObserveLoop.__noisebound_observeLoopPromise;
}
