import { SystemClock } from '@noisebound/attest';
import type { AttestationTokenClaims, MeasurementAllowlist } from '@noisebound/attest';
import { buildMockClaims, createMockSignatureVerifier, DEFAULT_MOCK_MEASUREMENT, signMockToken } from '@noisebound/attest';
import {
  createRedemptionRegistry,
  generateIssuerKeyPair,
  issueBlindSignature,
  requestBlindToken,
  unblindToken,
} from '@noisebound/blind-pay';
import type { IssuerKeyPair, RedemptionRegistry, Token } from '@noisebound/blind-pay';
import type { webcrypto } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authorizeCloudRequest } from '../authorize.js';

const SIGNING_KEY = 'test-signing-key';
const EXPECTED_NONCE = 'mock-nonce-0000';
const MAX_AGE_MS = 5 * 60_000;
const EXPECTED_MEASUREMENTS: MeasurementAllowlist = [
  { name: DEFAULT_MOCK_MEASUREMENT.name, algorithm: DEFAULT_MOCK_MEASUREMENT.algorithm, allowedValues: [DEFAULT_MOCK_MEASUREMENT.value] },
];

const clock = new SystemClock();

function buildToken(overrides: Partial<AttestationTokenClaims> = {}) {
  const claims = buildMockClaims(clock, overrides);
  return signMockToken(claims, SIGNING_KEY);
}

function verifyOptions() {
  return {
    expectedNonce: EXPECTED_NONCE,
    maxAgeMs: MAX_AGE_MS,
    clock,
    signatureVerifier: createMockSignatureVerifier(SIGNING_KEY),
  };
}

async function issueRedeemableToken(
  issuerPublicKey: webcrypto.CryptoKey,
  issuerPrivateKey: webcrypto.CryptoKey,
): Promise<Token> {
  const challenge = new TextEncoder().encode('cloud-inference-request');
  const { request, blindingState } = await requestBlindToken('purchase-proof-123', issuerPublicKey, challenge);
  const blindSignature = await issueBlindSignature(request, issuerPrivateKey);
  return unblindToken(blindSignature, blindingState, issuerPublicKey);
}

describe('authorizeCloudRequest', () => {
  let issuerKeyPair: IssuerKeyPair;
  let registry: RedemptionRegistry;

  beforeEach(async () => {
    issuerKeyPair = await generateIssuerKeyPair();
    registry = createRedemptionRegistry();
  });

  it('returns authorized when attestation and payment both succeed', async () => {
    const token = await issueRedeemableToken(issuerKeyPair.publicKey, issuerKeyPair.privateKey);
    const attestationToken = buildToken();

    const outcome = await authorizeCloudRequest(
      attestationToken,
      EXPECTED_MEASUREMENTS,
      verifyOptions(),
      token,
      issuerKeyPair.publicKey,
      registry,
    );

    expect(outcome.status).toBe('authorized');
    if (outcome.status === 'authorized') {
      expect(outcome.token).toBe(token);
      expect(outcome.attestation.overallResult).toBe(true);
    }
    expect(registry.has(token)).toBe(true);
  });

  it('returns attestation-failed and never attempts token redemption', async () => {
    const token = await issueRedeemableToken(issuerKeyPair.publicKey, issuerKeyPair.privateKey);
    const attestationToken = buildToken({ debugModeDisabled: false });

    const registrySpy = vi.spyOn(registry, 'markRedeemed');

    const outcome = await authorizeCloudRequest(
      attestationToken,
      EXPECTED_MEASUREMENTS,
      verifyOptions(),
      token,
      issuerKeyPair.publicKey,
      registry,
    );

    expect(outcome.status).toBe('attestation-failed');
    if (outcome.status === 'attestation-failed') {
      expect(outcome.attestation.debugModeDisabled).toBe(false);
    }
    expect(registrySpy).not.toHaveBeenCalled();
    expect(registry.has(token)).toBe(false);
  });

  it('returns payment-failed when the token has already been redeemed, after attestation succeeded', async () => {
    const token = await issueRedeemableToken(issuerKeyPair.publicKey, issuerKeyPair.privateKey);
    const attestationToken = buildToken();

    const first = await authorizeCloudRequest(
      attestationToken,
      EXPECTED_MEASUREMENTS,
      verifyOptions(),
      token,
      issuerKeyPair.publicKey,
      registry,
    );
    expect(first.status).toBe('authorized');

    const second = await authorizeCloudRequest(
      buildToken(),
      EXPECTED_MEASUREMENTS,
      verifyOptions(),
      token,
      issuerKeyPair.publicKey,
      registry,
    );

    expect(second.status).toBe('payment-failed');
    if (second.status === 'payment-failed') {
      expect(second.attestation.overallResult).toBe(true);
      expect(second.redemption.reason).toBe('already-redeemed');
    }
  });

  it('never redeems a token when attestation fails, even across repeated attempts', async () => {
    const token = await issueRedeemableToken(issuerKeyPair.publicKey, issuerKeyPair.privateKey);
    const badAttestationToken = buildToken({ overallResult: false });

    await authorizeCloudRequest(badAttestationToken, EXPECTED_MEASUREMENTS, verifyOptions(), token, issuerKeyPair.publicKey, registry);
    await authorizeCloudRequest(badAttestationToken, EXPECTED_MEASUREMENTS, verifyOptions(), token, issuerKeyPair.publicKey, registry);

    expect(registry.has(token)).toBe(false);

    const goodAttestationToken = buildToken();
    const outcome = await authorizeCloudRequest(
      goodAttestationToken,
      EXPECTED_MEASUREMENTS,
      verifyOptions(),
      token,
      issuerKeyPair.publicKey,
      registry,
    );
    expect(outcome.status).toBe('authorized');
  });
});
