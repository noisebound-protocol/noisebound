/**
 * Next.js server-startup hook (runs once per server process, not per
 * request/chat turn). This is what makes observe-loop's scheduled checks
 * genuinely background: they start ticking here, independent of anyone
 * hitting a route or triggering a server action.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { getObserveLoop } = await import('./lib/observeLoop/singleton');
    await getObserveLoop();
  }
}
