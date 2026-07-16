import type { Clock } from './clock.js';
import type {
  AttestationToken,
  AttestationTokenClaims,
  AttestationVerificationResult,
  ExpectedMeasurement,
  MeasurementAllowlist,
} from './types.js';

/**
 * Verifies the cryptographic signature over an attestation token's claims.
 *
 * REAL INTEGRATION POINT: in production this is JWS signature verification
 * against keys published by the attestation service's JWKS endpoint (NRAS
 * for GPU/NVSwitch tokens; the platform's SEV-SNP/TDX quote-verification
 * service for CPU tokens), including x5c certificate chain validation up
 * to the NVIDIA/AMD/Intel root of trust and an OCSP revocation check on
 * that chain. The mock signer/verifier pair in `testing.ts` stands in for
 * that here so the verification logic below can be exercised without live
 * hardware or network access.
 */
export type SignatureVerifier = (claims: AttestationTokenClaims, signature: string) => boolean;

/**
 * Checks a token's age against an injected clock, without touching
 * `Date.now()` directly, so freshness can be tested deterministically.
 * A token is fresh only if it has not expired AND was issued no longer
 * than `maxAgeMs` ago — bounding how long a legitimately-signed token can
 * be reused before a caller must re-attest.
 */
export function isAttestationFresh(token: AttestationToken, maxAgeMs: number, clock: Clock): boolean {
  const nowMs = clock.now().getTime();
  const notExpired = nowMs < token.claims.expiresAtMs;
  const notStale = nowMs - token.claims.issuedAtMs <= maxAgeMs;
  return notExpired && notStale;
}

function matchMeasurements(
  claims: AttestationTokenClaims,
  allowlist: MeasurementAllowlist,
): readonly ExpectedMeasurement[] {
  const mismatched: ExpectedMeasurement[] = [];
  for (const expected of allowlist) {
    const actual = claims.measurements.find(
      (m) => m.name === expected.name && m.algorithm === expected.algorithm,
    );
    if (!actual || !expected.allowedValues.includes(actual.value)) {
      mismatched.push(expected);
    }
  }
  return mismatched;
}

export interface VerifyAttestationTokenOptions {
  /** The nonce issued via {@link generateAttestationChallenge} for this attestation request. */
  readonly expectedNonce: string;
  /** Maximum age, in milliseconds, a token may be relied on after issuance. */
  readonly maxAgeMs: number;
  readonly clock: Clock;
  readonly signatureVerifier: SignatureVerifier;
}

/**
 * Validates an attestation token's signature and structure, and checks its
 * measurement values against `expectedMeasurements` — the pin to a
 * specific known-good enclave image, not just "any genuine enclave".
 *
 * This function alone does not decide whether to release a key: it reports
 * each check's outcome. Callers must route the result through
 * {@link shouldReleaseKey} before releasing any sensitive material.
 */
export function verifyAttestationToken(
  token: AttestationToken,
  expectedMeasurements: MeasurementAllowlist,
  options: VerifyAttestationTokenOptions,
): AttestationVerificationResult {
  const { expectedNonce, maxAgeMs, clock, signatureVerifier } = options;
  const reasons: string[] = [];

  const signatureValid = signatureVerifier(token.claims, token.signature);
  if (!signatureValid) reasons.push('signature verification failed');

  const nonceValid = token.claims.nonce === expectedNonce;
  if (!nonceValid) reasons.push('nonce does not match issued challenge (possible replay)');

  const fresh = isAttestationFresh(token, maxAgeMs, clock);
  if (!fresh) reasons.push('token is expired or older than max allowed age');

  const mismatchedMeasurements = matchMeasurements(token.claims, expectedMeasurements);
  const measurementsMatch = mismatchedMeasurements.length === 0;
  if (!measurementsMatch) reasons.push('measurements do not match expected allowlist');

  if (token.claims.measurementResult !== 'Success') {
    reasons.push('attestation service reported measurement validation failure');
  }
  if (!token.claims.overallResult) reasons.push('attestation service reported overall failure');
  if (!token.claims.secureBootEnabled) reasons.push('secure boot is not enabled');
  if (!token.claims.debugModeDisabled) reasons.push('hardware debug mode is enabled');

  return {
    signatureValid,
    nonceValid,
    fresh,
    measurementsMatch,
    mismatchedMeasurements,
    overallResult: token.claims.overallResult && token.claims.measurementResult === 'Success',
    secureBootEnabled: token.claims.secureBootEnabled,
    debugModeDisabled: token.claims.debugModeDisabled,
    issuedAt: new Date(token.claims.issuedAtMs),
    expiresAt: new Date(token.claims.expiresAtMs),
    reasons,
  };
}
