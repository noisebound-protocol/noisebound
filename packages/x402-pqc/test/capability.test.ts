import { describe, it, expect, beforeAll } from 'vitest';
import { generatePQCKeypair } from '@noisebound/pqc-wallet';
import type { PQCKeypair } from '@noisebound/pqc-wallet';
import { issueCapabilityToken, verifyCapabilitySignature } from '../src/capability.js';
import { verifyCapabilityToken } from '../src/verify-capability.js';
import { RevocationRegistry } from '../src/revocation.js';
import type { CapabilityToken, Scope } from '../src/types.js';

let granterKeypair: PQCKeypair;
const executionAddress = '0x000000000000000000000000000000000000dEaD';

beforeAll(() => {
  granterKeypair = generatePQCKeypair();
});

function issue(scopes: Scope[], ttlSeconds = 900): CapabilityToken {
  return issueCapabilityToken(granterKeypair, 'session-1', executionAddress, scopes, ttlSeconds);
}

describe('issueCapabilityToken', () => {
  it('returns a token with all required fields', () => {
    const token = issue([{ type: 'read-balance' }]);
    expect(token).toHaveProperty('tokenId');
    expect(token).toHaveProperty('sessionId', 'session-1');
    expect(token).toHaveProperty('scopes');
    expect(token).toHaveProperty('issuedAt');
    expect(token).toHaveProperty('expiresAt');
    expect(token).toHaveProperty('executionAddress', executionAddress);
    expect(token).toHaveProperty('granterPublicKey');
    expect(token).toHaveProperty('signature');
  });

  it('expiresAt is issuedAt + ttlSeconds', () => {
    const token = issue([{ type: 'read-balance' }], 300);
    expect(token.expiresAt).toBe(token.issuedAt + 300);
  });

  it('generates a unique tokenId each call', () => {
    const t1 = issue([{ type: 'read-balance' }]);
    const t2 = issue([{ type: 'read-balance' }]);
    expect(t1.tokenId).not.toBe(t2.tokenId);
  });
});

describe('verifyCapabilitySignature', () => {
  it('returns true for an untampered token', () => {
    const token = issue([{ type: 'read-balance' }]);
    expect(verifyCapabilitySignature(token)).toBe(true);
  });

  it('returns false when a scope is tampered with after signing', () => {
    const token = issue([{ type: 'sign-tx', maxAmountWei: '1000' }]);
    const tampered: CapabilityToken = {
      ...token,
      scopes: [{ type: 'sign-tx', maxAmountWei: '999999999' }],
    };
    expect(verifyCapabilitySignature(tampered)).toBe(false);
  });
});

describe('verifyCapabilityToken', () => {
  it('valid scoped action succeeds', () => {
    const token = issue([{ type: 'sign-tx', maxAmountWei: '1000000000000000000' }]);
    const registry = new RevocationRegistry();
    const result = verifyCapabilityToken(
      token,
      { type: 'sign-tx', maxAmountWei: '500000000000000000' },
      registry,
    );
    expect(result.valid).toBe(true);
  });

  it('out-of-scope action fails (amount over cap)', () => {
    const token = issue([{ type: 'sign-tx', maxAmountWei: '1000' }]);
    const registry = new RevocationRegistry();
    const result = verifyCapabilityToken(token, { type: 'sign-tx', maxAmountWei: '1001' }, registry);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('out of scope');
  });

  it('out-of-scope action fails (wrong contract address)', () => {
    const token = issue([
      { type: 'sign-tx', maxAmountWei: '1000', contractAddress: '0xAAA0000000000000000000000000000000AAAA' },
    ]);
    const registry = new RevocationRegistry();
    const result = verifyCapabilityToken(
      token,
      { type: 'sign-tx', maxAmountWei: '500', contractAddress: '0xBBB0000000000000000000000000000000BBBB' },
      registry,
    );
    expect(result.valid).toBe(false);
    expect(result.error).toBe('out of scope');
  });

  it('out-of-scope action fails (no matching scope type granted)', () => {
    const token = issue([{ type: 'read-balance' }]);
    const registry = new RevocationRegistry();
    const result = verifyCapabilityToken(token, { type: 'sign-tx', maxAmountWei: '1' }, registry);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('out of scope');
  });

  it('expired token fails closed', () => {
    const token = issue([{ type: 'sign-tx', maxAmountWei: '1000' }], -10);
    const registry = new RevocationRegistry();
    const result = verifyCapabilityToken(token, { type: 'sign-tx', maxAmountWei: '1' }, registry);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('token expired');
  });

  it('revoked token fails closed even though not yet expired', () => {
    const token = issue([{ type: 'sign-tx', maxAmountWei: '1000' }]);
    const registry = new RevocationRegistry();
    registry.revoke(token.tokenId, token.expiresAt);
    const result = verifyCapabilityToken(token, { type: 'sign-tx', maxAmountWei: '1' }, registry);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('token revoked');
  });

  it('invalid signature fails closed', () => {
    const token = issue([{ type: 'sign-tx', maxAmountWei: '1000' }]);
    const tampered: CapabilityToken = { ...token, executionAddress: '0x00000000000000000000000000000000000BEEF' };
    const registry = new RevocationRegistry();
    const result = verifyCapabilityToken(tampered, { type: 'sign-tx', maxAmountWei: '1' }, registry);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('invalid signature');
  });
});