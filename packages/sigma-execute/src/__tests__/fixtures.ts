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
import { generateIdentityKeyPair } from '@noisebound/identity';
import type { IdentityKeyPair } from '@noisebound/identity';
import {
  createRevocationRegistry,
  generateSessionKey,
  issueSessionCapability,
  revokeSessionCapability,
} from '@noisebound/pqc-wallet';
import type { RevocationRegistry, SessionCapability, SessionCapabilityScope } from '@noisebound/pqc-wallet';
import type { CloudInferenceActionRequest, OnChainMoneyActionRequest } from '../types.js';

export const SIGNING_KEY = 'test-signing-key';
export const EXPECTED_NONCE = 'mock-nonce-0000';
export const MAX_AGE_MS = 5 * 60_000;

export const attestClock = new SystemClock();

export const EXPECTED_MEASUREMENTS: MeasurementAllowlist = [
  {
    name: DEFAULT_MOCK_MEASUREMENT.name,
    algorithm: DEFAULT_MOCK_MEASUREMENT.algorithm,
    allowedValues: [DEFAULT_MOCK_MEASUREMENT.value],
  },
];

export function buildAttestationToken(overrides: Partial<AttestationTokenClaims> = {}) {
  const claims = buildMockClaims(attestClock, overrides);
  return signMockToken(claims, SIGNING_KEY);
}

export function verifyOptions() {
  return {
    expectedNonce: EXPECTED_NONCE,
    maxAgeMs: MAX_AGE_MS,
    clock: attestClock,
    signatureVerifier: createMockSignatureVerifier(SIGNING_KEY),
  };
}

export async function issueRedeemableToken(issuerKeyPair: IssuerKeyPair): Promise<Token> {
  const challenge = new TextEncoder().encode('cloud-inference-request');
  const { request, blindingState } = await requestBlindToken(
    'purchase-proof-123',
    issuerKeyPair.publicKey,
    challenge,
  );
  const blindSignature = await issueBlindSignature(request, issuerKeyPair.privateKey);
  return unblindToken(blindSignature, blindingState, issuerKeyPair.publicKey);
}

export async function setUpCloudFixtures(): Promise<{
  issuerKeyPair: IssuerKeyPair;
  redemptionRegistry: RedemptionRegistry;
  blindPayToken: Token;
}> {
  const issuerKeyPair = await generateIssuerKeyPair();
  const redemptionRegistry = createRedemptionRegistry();
  const blindPayToken = await issueRedeemableToken(issuerKeyPair);
  return { issuerKeyPair, redemptionRegistry, blindPayToken };
}

export function buildOnChainMoneyRequest(
  overrides: Partial<OnChainMoneyActionRequest> = {},
): OnChainMoneyActionRequest {
  return {
    kind: 'on-chain-money',
    id: 'action-money-1',
    description: 'Send funds to counterparty',
    amountCents: 34_000,
    currency: 'USD',
    amountWei: 1_000_000_000_000_000_000n,
    recipient: '0x4f2a1b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a',
    asset: 'ETH',
    ...overrides,
  };
}

export async function buildCloudInferenceRequest(
  overrides: Partial<CloudInferenceActionRequest> = {},
  claimOverrides: Partial<AttestationTokenClaims> = {},
): Promise<{ request: CloudInferenceActionRequest; issuerKeyPair: IssuerKeyPair; redemptionRegistry: RedemptionRegistry }> {
  const { issuerKeyPair, redemptionRegistry, blindPayToken } = await setUpCloudFixtures();

  const request: CloudInferenceActionRequest = {
    kind: 'cloud-inference',
    id: 'action-cloud-1',
    description: 'Summarize quarterly earnings call transcript',
    requiresDisclosure: true,
    attestationToken: buildAttestationToken(claimOverrides),
    expectedMeasurements: EXPECTED_MEASUREMENTS,
    verifyOptions: verifyOptions(),
    blindPayToken,
    ...overrides,
  };

  return { request, issuerKeyPair, redemptionRegistry };
}

export interface CapabilityFixture {
  identityKeyPair: IdentityKeyPair;
  capability: SessionCapability;
  sessionAddress: `0x${string}`;
}

export function issueCapabilityFixture(
  scope: SessionCapabilityScope = { maxSpendWei: (10n ** 18n).toString() },
  ttlMs = 60_000,
): CapabilityFixture {
  const identityKeyPair = generateIdentityKeyPair();
  const sessionKey = generateSessionKey();
  const capability = issueSessionCapability(identityKeyPair, sessionKey.publicKey, scope, ttlMs);
  return { identityKeyPair, capability, sessionAddress: sessionKey.address };
}

export function freshRevocationRegistry(): RevocationRegistry {
  return createRevocationRegistry();
}

export { revokeSessionCapability };
