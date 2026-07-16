import { generateIdentityKeyPair } from '@noisebound/identity';
import { createRevocationRegistry, generateSessionKey, issueSessionCapability, revokeSessionCapability } from '@noisebound/pqc-wallet';
import type { SessionCapabilityScope } from '@noisebound/pqc-wallet';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPaymentPayload } from '../createPaymentPayload.js';
import { verifyPaymentPayload } from '../verifyPaymentPayload.js';
import type { PaymentChallenge } from '../types.js';

const ENV_VAR_NAME = 'NEXT_PUBLIC_NOISEBOUND_NETWORK';
const originalValue = process.env[ENV_VAR_NAME];

const USDC_ADDRESS = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';

const challenge: PaymentChallenge = {
  scheme: 'exact',
  network: 'base-sepolia',
  maxAmountRequired: '1000000',
  resource: 'https://api.example.com/widgets',
  description: 'one widget',
  payTo: generateSessionKey().address,
  asset: USDC_ADDRESS,
  maxTimeoutSeconds: 60,
};

const scope: SessionCapabilityScope = { maxSpendWei: '2000000' };

describe('createPaymentPayload / verifyPaymentPayload', () => {
  beforeEach(() => {
    process.env[ENV_VAR_NAME] = 'base-sepolia';
  });

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env[ENV_VAR_NAME];
    } else {
      process.env[ENV_VAR_NAME] = originalValue;
    }
  });

  it('creates a payment payload within the session capability spend limit', async () => {
    const identityKeyPair = generateIdentityKeyPair();
    const sessionKey = generateSessionKey();
    const capability = issueSessionCapability(identityKeyPair, sessionKey.publicKey, scope, 60_000);

    const payload = await createPaymentPayload(capability, sessionKey, challenge);

    expect(payload.payload.authorization.from).toBe(sessionKey.address);
    expect(payload.payload.authorization.to).toBe(challenge.payTo);
    expect(payload.payload.authorization.value).toBe(challenge.maxAmountRequired);
    expect(payload.asset).toBe(USDC_ADDRESS);
  });

  it('rejects a payment payload whose amount exceeds the session capability spend limit', async () => {
    const identityKeyPair = generateIdentityKeyPair();
    const sessionKey = generateSessionKey();
    const tightScope: SessionCapabilityScope = { maxSpendWei: '500000' };
    const capability = issueSessionCapability(identityKeyPair, sessionKey.publicKey, tightScope, 60_000);

    await expect(createPaymentPayload(capability, sessionKey, challenge)).rejects.toThrow(/exceeds session capability spend limit/);
  });

  it('rejects creating a payment payload from an expired session capability', async () => {
    const identityKeyPair = generateIdentityKeyPair();
    const sessionKey = generateSessionKey();
    const capability = issueSessionCapability(identityKeyPair, sessionKey.publicKey, scope, -1);

    await expect(createPaymentPayload(capability, sessionKey, challenge)).rejects.toThrow(/expired/);
  });

  it('rejects creating a payment payload from a revoked session capability', async () => {
    const identityKeyPair = generateIdentityKeyPair();
    const sessionKey = generateSessionKey();
    const registry = createRevocationRegistry();
    const capability = issueSessionCapability(identityKeyPair, sessionKey.publicKey, scope, 60_000);
    revokeSessionCapability(registry, capability);

    await expect(createPaymentPayload(capability, sessionKey, challenge, { registry })).rejects.toThrow(/revoked/);
  });

  it('verifies a legitimately created payment payload round-trip', async () => {
    const identityKeyPair = generateIdentityKeyPair();
    const sessionKey = generateSessionKey();
    const capability = issueSessionCapability(identityKeyPair, sessionKey.publicKey, scope, 60_000);

    const payload = await createPaymentPayload(capability, sessionKey, challenge);
    const isValid = verifyPaymentPayload(payload, identityKeyPair.publicKey);

    expect(isValid).toBe(true);
  });

  it('fails verification when the payment amount has been tampered with after signing', async () => {
    const identityKeyPair = generateIdentityKeyPair();
    const sessionKey = generateSessionKey();
    const capability = issueSessionCapability(identityKeyPair, sessionKey.publicKey, scope, 60_000);

    const payload = await createPaymentPayload(capability, sessionKey, challenge);
    const tampered = {
      ...payload,
      payload: {
        ...payload.payload,
        authorization: { ...payload.payload.authorization, value: '2000000' },
      },
    };

    expect(verifyPaymentPayload(tampered, identityKeyPair.publicKey)).toBe(false);
  });

  it('fails verification when the recipient has been tampered with after signing', async () => {
    const identityKeyPair = generateIdentityKeyPair();
    const sessionKey = generateSessionKey();
    const capability = issueSessionCapability(identityKeyPair, sessionKey.publicKey, scope, 60_000);

    const payload = await createPaymentPayload(capability, sessionKey, challenge);
    const tampered = {
      ...payload,
      payload: {
        ...payload.payload,
        authorization: { ...payload.payload.authorization, to: generateSessionKey().address },
      },
    };

    expect(verifyPaymentPayload(tampered, identityKeyPair.publicKey)).toBe(false);
  });

  it('fails verification when the underlying session capability has been revoked', async () => {
    const identityKeyPair = generateIdentityKeyPair();
    const sessionKey = generateSessionKey();
    const registry = createRevocationRegistry();
    const capability = issueSessionCapability(identityKeyPair, sessionKey.publicKey, scope, 60_000);

    const payload = await createPaymentPayload(capability, sessionKey, challenge, { registry });
    revokeSessionCapability(registry, payload.capability);

    expect(verifyPaymentPayload(payload, identityKeyPair.publicKey, registry)).toBe(false);
  });

  it('fails verification against the wrong identity public key', async () => {
    const identityKeyPair = generateIdentityKeyPair();
    const impostorKeyPair = generateIdentityKeyPair();
    const sessionKey = generateSessionKey();
    const capability = issueSessionCapability(identityKeyPair, sessionKey.publicKey, scope, 60_000);

    const payload = await createPaymentPayload(capability, sessionKey, challenge);

    expect(verifyPaymentPayload(payload, impostorKeyPair.publicKey)).toBe(false);
  });
});
