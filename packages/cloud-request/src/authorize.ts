import { shouldReleaseKey, verifyAttestationToken } from '@noisebound/attest';
import type {
  AttestationToken,
  MeasurementAllowlist,
  VerifyAttestationTokenOptions,
} from '@noisebound/attest';
import { redeemToken } from '@noisebound/blind-pay';
import type { RedemptionRegistry, Token } from '@noisebound/blind-pay';
import type { webcrypto } from 'node:crypto';
import type { CloudRequestOutcome } from './types.js';

/**
 * The gate a client must pass before a cloud inference request payload is
 * allowed to leave for Noisebound's TEE-backed cloud tier.
 *
 * Order is deliberate and not interchangeable: attestation is verified
 * first, and the blind-pay token is only redeemed if attestation passes.
 * A failing attestation returns immediately without touching
 * `redemptionRegistry` — a token must never be spent against an enclave
 * that hasn't been verified.
 */
export async function authorizeCloudRequest(
  attestationToken: AttestationToken,
  expectedMeasurements: MeasurementAllowlist,
  verifyOptions: VerifyAttestationTokenOptions,
  blindPayToken: Token,
  issuerPublicKey: webcrypto.CryptoKey,
  redemptionRegistry: RedemptionRegistry,
): Promise<CloudRequestOutcome> {
  const attestation = verifyAttestationToken(attestationToken, expectedMeasurements, verifyOptions);

  if (!shouldReleaseKey(attestation)) {
    return { status: 'attestation-failed', attestation };
  }

  const redemption = await redeemToken(blindPayToken, issuerPublicKey, redemptionRegistry);

  if (!redemption.valid) {
    return { status: 'payment-failed', attestation, redemption };
  }

  return { status: 'authorized', attestation, token: blindPayToken };
}
