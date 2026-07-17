# @noisebound/attest

TEE attestation verification for Noisebound's cloud inference tier.

This package implements the challenge-response and verification logic for confirming that a cloud GPU is running inside a genuine, unmodified confidential-computing enclave before any sensitive key material is released to it. The claim shapes mirror the Entity Attestation Token (EAT, RFC 9711) issued by the NVIDIA Remote Attestation Service (NRAS) for GPU/NVSwitch attestation, plus the CPU-level confidential-computing claims (AMD SEV-SNP / Intel TDX) that gate the enclave the GPU sits inside.

Signature verification and wall-clock time are both injected (`SignatureVerifier`, `Clock`) rather than hardcoded, so the verification logic can run against mock tokens in tests without live hardware or network access. Real JWS/JWKS signature verification against NRAS's published keys (with x5c certificate chain and OCSP revocation checks) is left as an integration point for the caller — this package does not implement it.

## Public API

### Challenge / freshness

- `generateAttestationChallenge(clock: Clock, randomBytesFn?): AttestationChallenge` — generates a fresh, unpredictable nonce (32 random bytes, hex-encoded) that the device being attested must echo back in its token, preventing replay of an old token.
- `interface Clock { now(): Date }` — source of wall-clock time; verification code never calls `Date.now()` directly.
- `SystemClock` — production `Clock` implementation backed by the real system clock.

### Verification

- `verifyAttestationToken(token, expectedMeasurements, options): AttestationVerificationResult` — validates a token's signature, nonce (replay check), freshness, and measurements against an allowlist; returns a result object with every check broken out individually plus human-readable `reasons` for any failures. Does not itself decide whether to release a key.
- `isAttestationFresh(token, maxAgeMs, clock): boolean` — true only if the token has not expired and was issued no longer than `maxAgeMs` ago.
- `type SignatureVerifier = (claims, signature) => boolean` — injected function that checks a token's signature; production callers must supply real JWS verification, not the mock in `testing.ts`.
- `interface VerifyAttestationTokenOptions` — `{ expectedNonce, maxAgeMs, clock, signatureVerifier }` passed to `verifyAttestationToken`.

### Gating

- `shouldReleaseKey(result: AttestationVerificationResult): boolean` — the single choke point before releasing a key: true only if signature, nonce, freshness, measurements, overall result, secure boot, and debug-mode-disabled all pass. Any one failing check blocks release.

### Types (`types.ts`)

- `EnclaveTechnology` — `'sev-snp' | 'tdx' | 'nvidia-cc'`.
- `DeviceType` — `'gpu' | 'nvswitch' | 'cpu-tee'`.
- `EnclaveMeasurement` — a single named measurement register value (name, hash algorithm, hex digest).
- `EnclaveIdentity` — identity claims for the attested device (UEID, hardware model, OEM id, device type, technology, driver/VBIOS versions).
- `AttestationTokenClaims` — decoded claims of an attestation token (issuer, subject, issued/expiry times, token id, nonce, measurement result, secure boot / debug status, overall result, identity, measurements).
- `AttestationToken` — `{ claims, signature }`, a signed attestation token as received from the attestation service.
- `ExpectedMeasurement` — one expected measurement, with a list of allowed digest values (supports golden-value rotation).
- `MeasurementAllowlist` — `readonly ExpectedMeasurement[]`, the pin to a specific known-good enclave image.
- `AttestationChallenge` — `{ nonce, issuedAtMs }`, a freshly-issued challenge.
- `AttestationVerificationResult` — full per-check output of `verifyAttestationToken` (see above).

### Testing helpers (`testing.ts`)

Not for production use — these build and sign mock tokens so verification logic can be exercised without real hardware.

- `DEFAULT_MOCK_MEASUREMENT` — a sample `EnclaveMeasurement` matching what `buildMockClaims` produces by default.
- `buildMockEnclaveIdentity(overrides?): EnclaveIdentity` — builds a mock GPU identity, with fields overridable.
- `buildMockClaims(clock, overrides?): AttestationTokenClaims` — builds claims representing a genuine, freshly-attested enclave; override fields to simulate failure cases.
- `signMockToken(claims, signingKey): AttestationToken` — signs mock claims with an HMAC-SHA256 test key, producing a token shaped like a real decoded NRAS token.
- `createMockSignatureVerifier(signingKey): SignatureVerifier` — a `SignatureVerifier` that checks the HMAC produced by `signMockToken`, using a timing-safe comparison.

## Usage

The three pieces compose as a challenge/response/gate pipeline: issue a nonce, verify the token that comes back against it, then gate key release on the full result.

```ts
import {
  SystemClock,
  generateAttestationChallenge,
  verifyAttestationToken,
  shouldReleaseKey,
} from '@noisebound/attest';

const clock = new SystemClock();
const challenge = generateAttestationChallenge(clock);

// send `challenge.nonce` to the GPU, receive back a signed AttestationToken

const result = verifyAttestationToken(token, measurementAllowlist, {
  expectedNonce: challenge.nonce,
  maxAgeMs: 60_000,
  clock,
  signatureVerifier, // real JWS/JWKS verification in production
});

if (shouldReleaseKey(result)) {
  // release key material to the attested enclave
} else {
  // result.reasons explains which check(s) failed
}
```
