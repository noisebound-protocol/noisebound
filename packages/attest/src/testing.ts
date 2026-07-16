/**
 * Mock attestation token construction and signing for tests.
 *
 * This module exists because real hardware attestation (an actual NVIDIA
 * H100/H200 in Confidential Computing mode, backed by AMD SEV-SNP or Intel
 * TDX) cannot be produced in a test environment or CI. The claim shapes
 * here match the real NVIDIA Remote Attestation Service (NRAS) token
 * structure (see `types.ts`), and the HMAC-based signer/verifier below
 * stand in for real JWS signature verification.
 *
 * REAL INTEGRATION POINT: production code must NOT use
 * `createMockSignatureVerifier`. It must instead verify the JWS signature
 * on the token NRAS actually returns, against NRAS's published JWKS, with
 * x5c certificate chain validation to the hardware root of trust and an
 * OCSP revocation check — see the `SignatureVerifier` type in `verify.ts`.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Clock } from './clock.js';
import type { SignatureVerifier } from './verify.js';
import type {
  AttestationToken,
  AttestationTokenClaims,
  EnclaveIdentity,
  EnclaveMeasurement,
} from './types.js';

/** A measurement matching what {@link buildMockClaims} produces by default — use as the expected allowlist entry in tests. */
export const DEFAULT_MOCK_MEASUREMENT: EnclaveMeasurement = {
  name: 'gpu-vbios',
  algorithm: 'sha256',
  value: 'a'.repeat(64),
};

export function buildMockEnclaveIdentity(overrides: Partial<EnclaveIdentity> = {}): EnclaveIdentity {
  return {
    ueid: 'mock-ueid-0000',
    hwModel: 'GH100 A01 GSP BROM',
    oemId: 'nvidia-mock',
    deviceType: 'gpu',
    technology: 'nvidia-cc',
    driverVersion: '550.90.07',
    vbiosVersion: '96.00.5E.00.01',
    ...overrides,
  };
}

/** Builds a set of claims matching a genuine, unmodified, freshly-attested enclave. Override fields to simulate failure cases. */
export function buildMockClaims(
  clock: Clock,
  overrides: Partial<AttestationTokenClaims> = {},
): AttestationTokenClaims {
  const nowMs = clock.now().getTime();
  return {
    issuer: 'https://nras.attestation.nvidia.com',
    subject: 'mock-gpu-0',
    issuedAtMs: nowMs,
    expiresAtMs: nowMs + 5 * 60_000,
    tokenId: 'mock-jti-0000',
    nonce: 'mock-nonce-0000',
    measurementResult: 'Success',
    secureBootEnabled: true,
    debugModeDisabled: true,
    overallResult: true,
    identity: buildMockEnclaveIdentity(),
    measurements: [DEFAULT_MOCK_MEASUREMENT],
    ...overrides,
  };
}

function signMockClaims(claims: AttestationTokenClaims, signingKey: string): string {
  return createHmac('sha256', signingKey).update(JSON.stringify(claims)).digest('hex');
}

/** Signs mock claims with a test-only HMAC key, producing a token shaped like a real (decoded) NRAS token. */
export function signMockToken(claims: AttestationTokenClaims, signingKey: string): AttestationToken {
  return { claims, signature: signMockClaims(claims, signingKey) };
}

function timingSafeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Test-only stand-in for real JWS/JWKS signature verification (see the doc comment at the top of this file). */
export function createMockSignatureVerifier(signingKey: string): SignatureVerifier {
  return (claims, signature) => {
    const expected = signMockClaims(claims, signingKey);
    return timingSafeEqualHex(expected, signature);
  };
}
