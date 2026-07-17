/**
 * Minimal timer abstraction that {@link ObserveLoop} schedules checks
 * through. Injectable so tests can substitute a fake/manual implementation
 * instead of waiting on real wall-clock timers; production code uses
 * {@link RealScheduler}, which vitest's fake timers can also intercept
 * transparently since it delegates to the global `setInterval`.
 */
export interface Scheduler {
  setInterval(callback: () => void, intervalMs: number): unknown;
  clearInterval(handle: unknown): void;
}

/** Production {@link Scheduler} backed by the real `setInterval`/`clearInterval`. */
export class RealScheduler implements Scheduler {
  setInterval(callback: () => void, intervalMs: number): unknown {
    return setInterval(callback, intervalMs);
  }

  clearInterval(handle: unknown): void {
    clearInterval(handle as NodeJS.Timeout);
  }
}
