/**
 * Core types for TEE attestation verification.
 *
 * Shape mirrors the Entity Attestation Token (EAT, RFC 9711) that the
 * NVIDIA Remote Attestation Service (NRAS) issues as a signed JWT after
 * evaluating a GPU/NVSwitch attestation report, plus the CPU-level
 * confidential-computing claims (AMD SEV-SNP / Intel TDX) that gate the
 * enclave the GPU sits inside. Standard JWT claim names (`iss`, `sub`,
 * `iat`, `exp`, `jti`) and NVIDIA-specific claims (`eat_nonce`, `measres`,
 * `x-nvidia-*`) are represented here as typed fields rather than raw JWT
 * claim strings, since verification operates on parsed/decoded claims.
 */

/** Confidential-computing technology backing the enclave. */
export type EnclaveTechnology = 'sev-snp' | 'tdx' | 'nvidia-cc';

/** Kind of device the measurement/identity describes. */
export type DeviceType = 'gpu' | 'nvswitch' | 'cpu-tee';

/**
 * A single measurement register value, e.g. a GPU driver/VBIOS RIM digest
 * or an SEV-SNP/TDX launch measurement. Corresponds to entries under the
 * NRAS token's `submods` claim (per-device SHA-256/SHA-384 digests).
 */
export interface EnclaveMeasurement {
  /** Stable name for the measured component, e.g. "gpu-vbios", "gpu-driver-rim", "sev-snp-launch-measurement". */
  readonly name: string;
  readonly algorithm: 'sha256' | 'sha384';
  /** Hex-encoded digest value. */
  readonly value: string;
}

/**
 * Identity claims for the attested device, drawn from the NRAS token's
 * `ueid`, `hwmodel`, `oemid`, and `x-nvidia-device-type` claims.
 */
export interface EnclaveIdentity {
  /** Universal Entity ID — unique device identifier (NRAS `ueid` claim). */
  readonly ueid: string;
  /** Hardware model string, e.g. "GH100 A01 GSP BROM" (NRAS `hwmodel` claim). */
  readonly hwModel: string;
  /** Firmware/OEM manufacturer identifier (NRAS `oemid` claim). */
  readonly oemId: string;
  readonly deviceType: DeviceType;
  readonly technology: EnclaveTechnology;
  readonly driverVersion?: string;
  readonly vbiosVersion?: string;
}

/**
 * Decoded claims of an attestation token. Corresponds to the payload of
 * the JWT/EAT that NRAS (or a CPU attestation service for SEV-SNP/TDX)
 * returns after evaluating a hardware attestation report.
 */
export interface AttestationTokenClaims {
  /** Token issuer, e.g. "https://nras.attestation.nvidia.com" (JWT `iss`). */
  readonly issuer: string;
  /** Subject identifier for the attested device/enclave (JWT `sub`). */
  readonly subject: string;
  /** Issued-at time, in epoch milliseconds (JWT `iat`, converted from seconds). */
  readonly issuedAtMs: number;
  /** Expiry time, in epoch milliseconds (JWT `exp`, converted from seconds). */
  readonly expiresAtMs: number;
  /** Unique token id (JWT `jti`). */
  readonly tokenId: string;
  /** Challenge nonce echoed back by the attester (EAT `eat_nonce`). Used for replay protection. */
  readonly nonce: string;
  /** Whether measured values matched the device's own golden reference (NRAS `measres`: "Success" | "Failure"). */
  readonly measurementResult: 'Success' | 'Failure';
  /** Secure boot enabled, per attestation report (`secboot`). */
  readonly secureBootEnabled: boolean;
  /** True if hardware debug mode was disabled at attestation time (`dbgstat`). Debug-enabled hardware must never pass. */
  readonly debugModeDisabled: boolean;
  /** Overall pass/fail verdict from the attestation service (`x-nvidia-overall-att-result` for GPU tokens). */
  readonly overallResult: boolean;
  readonly identity: EnclaveIdentity;
  readonly measurements: readonly EnclaveMeasurement[];
}

/**
 * A signed attestation token as received from the attestation service.
 * `signature` is the detached signature/MAC over the canonical encoding of
 * `claims`, verified via an injected {@link SignatureVerifier}.
 *
 * REAL INTEGRATION POINT: in production this is the compact JWS string
 * returned by NRAS (or the CPU attestation service). A real client would
 * decode the JWS header/payload/signature and verify it against NRAS's
 * published JWKS (with x5c certificate chain validation back to the
 * NVIDIA/AMD/Intel root of trust, plus OCSP revocation checks) instead of
 * the mock verifier used here.
 */
export interface AttestationToken {
  readonly claims: AttestationTokenClaims;
  readonly signature: string;
}

/** One expected (known-good) measurement, allowing multiple accepted digests for golden-value rotation. */
export interface ExpectedMeasurement {
  readonly name: string;
  readonly algorithm: 'sha256' | 'sha384';
  readonly allowedValues: readonly string[];
}

/** Allowlist of known-good measurements a token's measurements must match — the pin to a specific enclave image. */
export type MeasurementAllowlist = readonly ExpectedMeasurement[];

/** A fresh challenge nonce for the challenge-response attestation flow. */
export interface AttestationChallenge {
  readonly nonce: string;
  readonly issuedAtMs: number;
}

/**
 * Full result of verifying an attestation token. Every check is exposed as
 * its own field so callers (and tests) can see exactly which check failed,
 * rather than only a final boolean.
 */
export interface AttestationVerificationResult {
  readonly signatureValid: boolean;
  /** True if the token's nonce matches the challenge that was issued for this request. */
  readonly nonceValid: boolean;
  /** True if the token has not expired and is not older than the caller's max age. */
  readonly fresh: boolean;
  /** True if every entry in the measurement allowlist matched the token's measurements. */
  readonly measurementsMatch: boolean;
  /** Expected measurements that did not match (or were missing) — empty when {@link measurementsMatch} is true. */
  readonly mismatchedMeasurements: readonly ExpectedMeasurement[];
  /** The attestation service's own overall verdict (`x-nvidia-overall-att-result` / equivalent). */
  readonly overallResult: boolean;
  readonly secureBootEnabled: boolean;
  readonly debugModeDisabled: boolean;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
  /** Human-readable reasons for any failed check, for logging/debugging. */
  readonly reasons: readonly string[];
}
