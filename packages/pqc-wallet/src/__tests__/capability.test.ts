import { generateIdentityKeyPair } from '@noisebound/identity';
import { describe, expect, it } from 'vitest';
import { issueSessionCapability, verifySessionCapability } from '../capability.js';
import { createRevocationRegistry, revokeSessionCapability } from '../revocation.js';
import { generateSessionKey } from '../sessionKey.js';
import type { SessionCapabilityScope } from '../types.js';

const scope: SessionCapabilityScope = { maxSpendWei: '1000000000000000000' };

describe('issueSessionCapability / verifySessionCapability', () => {
  it('round-trips: a capability issued by an identity key verifies with its matching public key', () => {
    const identityKeyPair = generateIdentityKeyPair();
    const sessionKey = generateSessionKey();

    const capability = issueSessionCapability(identityKeyPair, sessionKey.publicKey, scope, 60_000);
    const isValid = verifySessionCapability(identityKeyPair.publicKey, capability);

    expect(isValid).toBe(true);
    expect(capability.payload.sessionAddress).toBe(sessionKey.address);
  });

  it('fails verification against the wrong identity public key', () => {
    const identityKeyPair = generateIdentityKeyPair();
    const impostorKeyPair = generateIdentityKeyPair();
    const sessionKey = generateSessionKey();

    const capability = issueSessionCapability(identityKeyPair, sessionKey.publicKey, scope, 60_000);
    const isValid = verifySessionCapability(impostorKeyPair.publicKey, capability);

    expect(isValid).toBe(false);
  });

  it('fails verification when the token has expired', () => {
    const identityKeyPair = generateIdentityKeyPair();
    const sessionKey = generateSessionKey();

    const capability = issueSessionCapability(identityKeyPair, sessionKey.publicKey, scope, -1);
    const isValid = verifySessionCapability(identityKeyPair.publicKey, capability);

    expect(isValid).toBe(false);
  });

  it('fails verification when the scope has been tampered with', () => {
    const identityKeyPair = generateIdentityKeyPair();
    const sessionKey = generateSessionKey();

    const capability = issueSessionCapability(identityKeyPair, sessionKey.publicKey, scope, 60_000);
    const tampered = {
      ...capability,
      payload: { ...capability.payload, scope: { maxSpendWei: '999999999999999999999' } },
    };

    const isValid = verifySessionCapability(identityKeyPair.publicKey, tampered);

    expect(isValid).toBe(false);
  });

  it('fails verification when the token has been revoked', () => {
    const identityKeyPair = generateIdentityKeyPair();
    const sessionKey = generateSessionKey();
    const registry = createRevocationRegistry();

    const capability = issueSessionCapability(identityKeyPair, sessionKey.publicKey, scope, 60_000);
    expect(verifySessionCapability(identityKeyPair.publicKey, capability, registry)).toBe(true);

    revokeSessionCapability(registry, capability);

    expect(verifySessionCapability(identityKeyPair.publicKey, capability, registry)).toBe(false);
  });
});
