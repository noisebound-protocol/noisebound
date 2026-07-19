import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Clock } from '@noisebound/sigma-core';
import type { CheckDefinition } from '@noisebound/observe-loop';
import { FilesystemStore, InMemoryStore, deriveMemoryEncryptionKey } from '@noisebound/memory-store';
import { ObserveFactStore } from '../factStore';
import { buildObserveLoop } from '../runtime';

/**
 * Integration coverage for how apps/app actually wires observe-loop to
 * memory-store: a real ObserveLoop, a real FilesystemStore writing real
 * encrypted JSON files to a temp directory, and this app's `buildObserveLoop`
 * adapter in between. Nothing here is mocked except the check bodies
 * themselves (arbitrary counters), which is exactly the seam production code
 * (lib/observeLoop/checks.ts) plugs real work into.
 */

class FakeClock implements Clock {
  constructor(private current: Date) {}

  now(): Date {
    return this.current;
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

async function tick(clock: FakeClock, ms: number): Promise<void> {
  clock.advance(ms);
  await vi.advanceTimersByTimeAsync(ms);
}

function counterCheck(id: string, checkIntervalMs: number): { definition: CheckDefinition<number>; runs: () => number } {
  let runs = 0;
  const definition: CheckDefinition<number> = {
    id,
    description: id,
    checkIntervalMs,
    initialValue: 0,
    run: () => {
      runs += 1;
      return runs;
    },
  };
  return { definition, runs: () => runs };
}

describe('observe-loop wired into apps/app via memory-store', () => {
  let dataDir: string;
  const key = deriveMemoryEncryptionKey(Buffer.from('integration-test-seed'));

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'noisebound-observe-loop-'));
  });

  afterEach(async () => {
    vi.useRealTimers();
    await rm(dataDir, { recursive: true, force: true });
  });

  it('actually schedules each registered check on its own independent timer interval', async () => {
    vi.useFakeTimers();

    // Fake timers fire many ticks back-to-back within a single microtask
    // flush, which races real disk I/O on some platforms — this test isolates
    // the scheduling behavior with an in-memory-backed store; real-disk
    // persistence via the same buildObserveLoop/ObserveFactStore code path is
    // covered (sequentially, with real timers) by the tests below.
    const factStore = new ObserveFactStore(new InMemoryStore(), key);
    const clock = new FakeClock(new Date('2026-01-01T00:00:00.000Z'));
    const fast = counterCheck('fast-check', 1_000);
    const slow = counterCheck('slow-check', 5_000);

    const loop = await buildObserveLoop({
      factStore,
      clock,
      checks: [fast.definition, slow.definition],
    });
    loop.start();

    await tick(clock, 5_000);
    loop.stop();

    expect(fast.runs()).toBe(5);
    expect(slow.runs()).toBe(1);

    const fastFact = await factStore.load('fast-check');
    const slowFact = await factStore.load('slow-check');
    expect(fastFact?.value).toBe(5);
    expect(slowFact?.value).toBe(1);
  });

  it('persists each check result as an encrypted file in the real memory-store filesystem backend', async () => {
    const factStore = new ObserveFactStore(new FilesystemStore(dataDir), key);
    const clock = new FakeClock(new Date('2026-01-01T00:00:00.000Z'));
    const check = counterCheck('persisted-check', 1_000);

    const loop = await buildObserveLoop({ factStore, clock, checks: [check.definition] });
    await loop.runNow('persisted-check');

    const filesOnDisk = await readdir(dataDir);
    expect(filesOnDisk.length).toBe(1);

    const persisted = await factStore.load('persisted-check');
    expect(persisted?.value).toBe(1);
    expect(persisted?.lastCheckedAt).toEqual(clock.now());
    expect(persisted?.description).toBe('persisted-check');

    // Sanity check that the on-disk representation is genuinely encrypted:
    // metadata (id/timestamps) stays in the clear by design, but the fact's
    // content (description/value) must not appear as plaintext anywhere.
    const raw = await (await import('node:fs/promises')).readFile(join(dataDir, filesOnDisk[0]!), 'utf8');
    expect(raw).toContain('"ciphertext"');
    expect(raw).not.toContain('"value"');
    expect(raw).not.toContain('"description"');
  });

  it('resumes from persisted state across a simulated process restart instead of re-seeding the static default', async () => {
    const clock = new FakeClock(new Date('2026-01-01T00:00:00.000Z'));

    const firstProcessStore = new ObserveFactStore(new FilesystemStore(dataDir), key);
    const firstRun = counterCheck('restart-check', 1_000);
    const loopBeforeRestart = await buildObserveLoop({
      factStore: firstProcessStore,
      clock,
      checks: [firstRun.definition],
    });
    await loopBeforeRestart.runNow('restart-check');
    expect(loopBeforeRestart.getFact('restart-check')?.value).toBe(1);

    // Simulate a fresh server process: brand-new ObserveFactStore and
    // ObserveLoop instances pointed at the same on-disk directory, with a
    // check definition whose static initialValue is 0 and whose run()
    // has not been invoked yet.
    const secondProcessStore = new ObserveFactStore(new FilesystemStore(dataDir), key);
    const neverRun: CheckDefinition<number> = {
      id: 'restart-check',
      description: 'restart-check',
      checkIntervalMs: 1_000,
      initialValue: 0,
      run: () => {
        throw new Error('should not run before the restart assertion below');
      },
    };
    const loopAfterRestart = await buildObserveLoop({
      factStore: secondProcessStore,
      clock,
      checks: [neverRun],
    });

    const resumedFact = loopAfterRestart.getFact('restart-check');
    expect(resumedFact?.value).toBe(1);
    expect(resumedFact?.lastCheckedAt).toEqual(clock.now());
  });

  it('isolates a failing check from a healthy one while still persisting the healthy one', async () => {
    const factStore = new ObserveFactStore(new FilesystemStore(dataDir), key);
    const clock = new FakeClock(new Date('2026-01-01T00:00:00.000Z'));
    const errors: Array<{ checkId: string; error: unknown }> = [];

    const broken: CheckDefinition<number> = {
      id: 'broken-check',
      description: 'broken',
      checkIntervalMs: 1_000,
      initialValue: 0,
      run: () => {
        throw new Error('boom');
      },
    };
    const healthy = counterCheck('healthy-check', 1_000);

    const loop = await buildObserveLoop({
      factStore,
      clock,
      checks: [broken, healthy.definition],
      onError: (checkId, error) => errors.push({ checkId, error }),
    });

    await loop.runNow('broken-check');
    await loop.runNow('healthy-check');

    expect(errors).toHaveLength(1);
    expect(errors[0]?.checkId).toBe('broken-check');

    const healthyFact = await factStore.load('healthy-check');
    expect(healthyFact?.value).toBe(1);
    const brokenFact = await factStore.load('broken-check');
    expect(brokenFact).toBeUndefined();
  });
});
