import { describe, expect, it } from 'vitest';
import { shouldReleaseKey } from '../src/gate.js';
import type { AttestationVerificationResult } from '../src/types.js';

const FULLY_PASSING_RESULT: AttestationVerificationResult = {
  signatureValid: true,
  nonceValid: true,
  fresh: true,
  measurementsMatch: true,
  mismatchedMeasurements: [],
  overallResult: true,
  secureBootEnabled: true,
  debugModeDisabled: true,
  issuedAt: new Date(1_000_000),
  expiresAt: new Date(1_060_000),
  reasons: [],
};

describe('shouldReleaseKey', () => {
  it('returns true when every check passes', () => {
    expect(shouldReleaseKey(FULLY_PASSING_RESULT)).toBe(true);
  });

  it('returns false when only the signature check fails', () => {
    expect(shouldReleaseKey({ ...FULLY_PASSING_RESULT, signatureValid: false })).toBe(false);
  });

  it('returns false when only the nonce check fails', () => {
    expect(shouldReleaseKey({ ...FULLY_PASSING_RESULT, nonceValid: false })).toBe(false);
  });

  it('returns false when only the freshness check fails', () => {
    expect(shouldReleaseKey({ ...FULLY_PASSING_RESULT, fresh: false })).toBe(false);
  });

  it('returns false when only the measurements check fails', () => {
    expect(shouldReleaseKey({ ...FULLY_PASSING_RESULT, measurementsMatch: false })).toBe(false);
  });

  it('returns false when only the attestation service overall result fails', () => {
    expect(shouldReleaseKey({ ...FULLY_PASSING_RESULT, overallResult: false })).toBe(false);
  });

  it('returns false when secure boot is reported disabled', () => {
    expect(shouldReleaseKey({ ...FULLY_PASSING_RESULT, secureBootEnabled: false })).toBe(false);
  });

  it('returns false when hardware debug mode is reported enabled', () => {
    expect(shouldReleaseKey({ ...FULLY_PASSING_RESULT, debugModeDisabled: false })).toBe(false);
  });

  it('returns false when every check fails', () => {
    expect(
      shouldReleaseKey({
        ...FULLY_PASSING_RESULT,
        signatureValid: false,
        nonceValid: false,
        fresh: false,
        measurementsMatch: false,
        overallResult: false,
        secureBootEnabled: false,
        debugModeDisabled: false,
      }),
    ).toBe(false);
  });
});
