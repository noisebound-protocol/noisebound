import { generateIdentityKeyPair } from '@noisebound/identity';
import { describe, expect, it } from 'vitest';
import { issueWebActionCapability, verifyWebActionCapability } from '../webCapability.js';
import { createRevocationRegistry, revokeWebActionCapability } from '../revocation.js';
import { generateWebActionKey } from '../webActionKey.js';
import type { WebActionScope } from '../types.js';

const scope: WebActionScope = {
  allowedOrigins: ['https://api.example.com'],
  allowedMethods: ['GET', 'POST'],
  maxCalls: 10,
};

describe('issueWebActionCapability / verifyWebActionCapability', () => {
  it('round-trips: a capability issued by an identity key verifies with its matching public key', async () => {
    const identityKeyPair = generateIdentityKeyPair();
    const subjectKey = await generateWebActionKey();

    const capability = issueWebActionCapability(identityKeyPair, subjectKey.publicKey, scope, 60_000);
    const isValid = verifyWebActionCapability(identityKeyPair.publicKey, capability);

    expect(isValid).toBe(true);
    expect(capability.payload.subjectPublicKey).toBe(subjectKey.publicKey);
  });

  it('fails verification against the wrong identity public key', async () => {
    const identityKeyPair = generateIdentityKeyPair();
    const impostorKeyPair = generateIdentityKeyPair();
    const subjectKey = await generateWebActionKey();

    const capability = issueWebActionCapability(identityKeyPair, subjectKey.publicKey, scope, 60_000);
    const isValid = verifyWebActionCapability(impostorKeyPair.publicKey, capability);

    expect(isValid).toBe(false);
  });

  it('fails verification when the token has expired', async () => {
    const identityKeyPair = generateIdentityKeyPair();
    const subjectKey = await generateWebActionKey();

    const capability = issueWebActionCapability(identityKeyPair, subjectKey.publicKey, scope, -1);
    const isValid = verifyWebActionCapability(identityKeyPair.publicKey, capability);

    expect(isValid).toBe(false);
  });

  it('fails verification when the scope has been tampered with', async () => {
    const identityKeyPair = generateIdentityKeyPair();
    const subjectKey = await generateWebActionKey();

    const capability = issueWebActionCapability(identityKeyPair, subjectKey.publicKey, scope, 60_000);
    const tampered = {
      ...capability,
      payload: {
        ...capability.payload,
        scope: { ...scope, allowedOrigins: ['https://evil.example.com'] },
      },
    };

    const isValid = verifyWebActionCapability(identityKeyPair.publicKey, tampered);

    expect(isValid).toBe(false);
  });

  it('fails verification when the token has been revoked', async () => {
    const identityKeyPair = generateIdentityKeyPair();
    const subjectKey = await generateWebActionKey();
    const registry = createRevocationRegistry();

    const capability = issueWebActionCapability(identityKeyPair, subjectKey.publicKey, scope, 60_000);
    expect(verifyWebActionCapability(identityKeyPair.publicKey, capability, registry)).toBe(true);

    revokeWebActionCapability(registry, capability);

    expect(verifyWebActionCapability(identityKeyPair.publicKey, capability, registry)).toBe(false);
  });
});
