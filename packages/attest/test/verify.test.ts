import { describe, expect, it } from 'vitest';
import { generateAttestationChallenge } from '../src/challenge.js';
import type { MeasurementAllowlist } from '../src/types.js';
import {
  DEFAULT_MOCK_MEASUREMENT,
  buildMockClaims,
  createMockSignatureVerifier,
  signMockToken,
} from '../src/testing.js';
import { isAttestationFresh, verifyAttestationToken } from '../src/verify.js';
import { FakeClock } from './fake-clock.js';

const SIGNING_KEY = 'test-signing-key';
const MAX_AGE_MS = 60_000;

const EXPECTED_MEASUREMENTS: MeasurementAllowlist = [
  {
    name: DEFAULT_MOCK_MEASUREMENT.name,
    algorithm: DEFAULT_MOCK_MEASUREMENT.algorithm,
    allowedValues: [DEFAULT_MOCK_MEASUREMENT.value],
  },
];

describe('verifyAttestationToken', () => {
  it('passes a valid attestation with matching measurements', () => {
    const clock = new FakeClock(1_000_000);
    const challenge = generateAttestationChallenge(clock);
    const claims = buildMockClaims(clock, { nonce: challenge.nonce });
    const token = signMockToken(claims, SIGNING_KEY);

    const result = verifyAttestationToken(token, EXPECTED_MEASUREMENTS, {
      expectedNonce: challenge.nonce,
      maxAgeMs: MAX_AGE_MS,
      clock,
      signatureVerifier: createMockSignatureVerifier(SIGNING_KEY),
    });

    expect(result.signatureValid).toBe(true);
    expect(result.nonceValid).toBe(true);
    expect(result.fresh).toBe(true);
    expect(result.measurementsMatch).toBe(true);
    expect(result.mismatchedMeasurements).toEqual([]);
    expect(result.overallResult).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it('fails signature verification when the token has been tampered with after signing', () => {
    const clock = new FakeClock(1_000_000);
    const challenge = generateAttestationChallenge(clock);
    const claims = buildMockClaims(clock, { nonce: challenge.nonce });
    const token = signMockToken(claims, SIGNING_KEY);
    const tamperedToken = { ...token, claims: { ...token.claims, subject: 'attacker-controlled-subject' } };

    const result = verifyAttestationToken(tamperedToken, EXPECTED_MEASUREMENTS, {
      expectedNonce: challenge.nonce,
      maxAgeMs: MAX_AGE_MS,
      clock,
      signatureVerifier: createMockSignatureVerifier(SIGNING_KEY),
    });

    expect(result.signatureValid).toBe(false);
    expect(result.reasons).toContain('signature verification failed');
  });

  it('fails signature verification when signed with a different key than the verifier expects', () => {
    const clock = new FakeClock(1_000_000);
    const challenge = generateAttestationChallenge(clock);
    const claims = buildMockClaims(clock, { nonce: challenge.nonce });
    const token = signMockToken(claims, 'a-different-key');

    const result = verifyAttestationToken(token, EXPECTED_MEASUREMENTS, {
      expectedNonce: challenge.nonce,
      maxAgeMs: MAX_AGE_MS,
      clock,
      signatureVerifier: createMockSignatureVerifier(SIGNING_KEY),
    });

    expect(result.signatureValid).toBe(false);
  });

  it('fails freshness once the token expires, using the injected fake clock', () => {
    const clock = new FakeClock(1_000_000);
    const challenge = generateAttestationChallenge(clock);
    const claims = buildMockClaims(clock, { nonce: challenge.nonce, expiresAtMs: clock.now().getTime() + 1_000 });
    const token = signMockToken(claims, SIGNING_KEY);

    clock.advanceMs(2_000);

    const result = verifyAttestationToken(token, EXPECTED_MEASUREMENTS, {
      expectedNonce: challenge.nonce,
      maxAgeMs: MAX_AGE_MS,
      clock,
      signatureVerifier: createMockSignatureVerifier(SIGNING_KEY),
    });

    expect(result.fresh).toBe(false);
    expect(result.reasons).toContain('token is expired or older than max allowed age');
  });

  it('fails freshness once the token exceeds maxAgeMs, even if not yet expired', () => {
    const clock = new FakeClock(1_000_000);
    const challenge = generateAttestationChallenge(clock);
    const claims = buildMockClaims(clock, { nonce: challenge.nonce, expiresAtMs: clock.now().getTime() + 10_000_000 });
    const token = signMockToken(claims, SIGNING_KEY);

    clock.advanceMs(MAX_AGE_MS + 1);

    expect(isAttestationFresh(token, MAX_AGE_MS, clock)).toBe(false);
  });

  it('fails nonce validation on a replayed (stale) token whose nonce does not match the current challenge', () => {
    const clock = new FakeClock(1_000_000);
    const oldChallenge = generateAttestationChallenge(clock);
    const claims = buildMockClaims(clock, { nonce: oldChallenge.nonce });
    const replayedToken = signMockToken(claims, SIGNING_KEY);

    const newChallenge = generateAttestationChallenge(clock);

    const result = verifyAttestationToken(replayedToken, EXPECTED_MEASUREMENTS, {
      expectedNonce: newChallenge.nonce,
      maxAgeMs: MAX_AGE_MS,
      clock,
      signatureVerifier: createMockSignatureVerifier(SIGNING_KEY),
    });

    expect(result.nonceValid).toBe(false);
    expect(result.reasons).toContain('nonce does not match issued challenge (possible replay)');
  });

  it('fails measurement matching when the enclave image measurement differs from the allowlist', () => {
    const clock = new FakeClock(1_000_000);
    const challenge = generateAttestationChallenge(clock);
    const claims = buildMockClaims(clock, {
      nonce: challenge.nonce,
      measurements: [{ ...DEFAULT_MOCK_MEASUREMENT, value: 'b'.repeat(64) }],
    });
    const token = signMockToken(claims, SIGNING_KEY);

    const result = verifyAttestationToken(token, EXPECTED_MEASUREMENTS, {
      expectedNonce: challenge.nonce,
      maxAgeMs: MAX_AGE_MS,
      clock,
      signatureVerifier: createMockSignatureVerifier(SIGNING_KEY),
    });

    expect(result.measurementsMatch).toBe(false);
    expect(result.mismatchedMeasurements).toEqual(EXPECTED_MEASUREMENTS);
    expect(result.reasons).toContain('measurements do not match expected allowlist');
  });

  it('fails measurement matching when an expected measurement is entirely missing from the token', () => {
    const clock = new FakeClock(1_000_000);
    const challenge = generateAttestationChallenge(clock);
    const claims = buildMockClaims(clock, { nonce: challenge.nonce, measurements: [] });
    const token = signMockToken(claims, SIGNING_KEY);

    const result = verifyAttestationToken(token, EXPECTED_MEASUREMENTS, {
      expectedNonce: challenge.nonce,
      maxAgeMs: MAX_AGE_MS,
      clock,
      signatureVerifier: createMockSignatureVerifier(SIGNING_KEY),
    });

    expect(result.measurementsMatch).toBe(false);
  });
});
