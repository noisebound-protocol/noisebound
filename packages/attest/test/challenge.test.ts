import { describe, expect, it } from 'vitest';
import { generateAttestationChallenge } from '../src/challenge.js';
import { FakeClock } from './fake-clock.js';

describe('generateAttestationChallenge', () => {
  it('produces a fresh, sufficiently long nonce tied to the current clock time', () => {
    const clock = new FakeClock(1_000_000);

    const challenge = generateAttestationChallenge(clock);

    expect(challenge.nonce).toHaveLength(64);
    expect(challenge.issuedAtMs).toBe(1_000_000);
  });

  it('produces a different nonce on each call', () => {
    const clock = new FakeClock(1_000_000);

    const first = generateAttestationChallenge(clock);
    const second = generateAttestationChallenge(clock);

    expect(first.nonce).not.toBe(second.nonce);
  });
});
