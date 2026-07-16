import type { AttestationVerificationResult } from '@noisebound/attest';
import type { RedemptionOutcome, Token } from '@noisebound/blind-pay';

/**
 * Outcome of {@link authorizeCloudRequest}. A discriminated union on
 * `status` so callers must handle every gate outcome explicitly before a
 * request payload is allowed to leave the client.
 */
export type CloudRequestOutcome =
  | AttestationFailedOutcome
  | PaymentFailedOutcome
  | AuthorizedOutcome;

/** The enclave failed attestation verification. No blind-pay token was redeemed. */
export interface AttestationFailedOutcome {
  readonly status: 'attestation-failed';
  readonly attestation: AttestationVerificationResult;
}

/** Attestation passed, but the blind-pay token could not be redeemed (e.g. double-spend). */
export interface PaymentFailedOutcome {
  readonly status: 'payment-failed';
  readonly attestation: AttestationVerificationResult;
  readonly redemption: Extract<RedemptionOutcome, { readonly valid: false }>;
}

/** Both gates passed. Carries what's needed to proceed with the cloud inference call. */
export interface AuthorizedOutcome {
  readonly status: 'authorized';
  readonly attestation: AttestationVerificationResult;
  readonly token: Token;
}
