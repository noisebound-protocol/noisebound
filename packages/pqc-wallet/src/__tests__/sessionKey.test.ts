import { describe, expect, it } from 'vitest';
import { generateSessionKey } from '../sessionKey.js';

describe('generateSessionKey', () => {
  it('produces a valid secp256k1 keypair with a matching address', () => {
    const sessionKey = generateSessionKey();

    expect(sessionKey.privateKey).toMatch(/^0x[0-9a-f]{64}$/);
    expect(sessionKey.publicKey).toMatch(/^0x0[23][0-9a-f]{64}$/);
    expect(sessionKey.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it('produces distinct keys on each call', () => {
    const first = generateSessionKey();
    const second = generateSessionKey();

    expect(first.privateKey).not.toBe(second.privateKey);
    expect(first.publicKey).not.toBe(second.publicKey);
    expect(first.address).not.toBe(second.address);
  });
});
