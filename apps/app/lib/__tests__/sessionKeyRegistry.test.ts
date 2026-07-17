import { describe, expect, it } from 'vitest';
import type { SessionKey } from '@noisebound/pqc-wallet';
import { registerSessionKey, resolveSessionKey } from '../sessionKeyRegistry';

const sessionKey: SessionKey = {
  address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  publicKey: '0x04sessionpublickey',
  privateKey: '0xsessionprivatekey',
};

describe('sessionKeyRegistry', () => {
  it('resolves a registered session key by its address', () => {
    registerSessionKey(sessionKey);
    expect(resolveSessionKey(sessionKey.address)).toBe(sessionKey);
  });

  it('returns undefined for an address that was never registered', () => {
    expect(resolveSessionKey('0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')).toBeUndefined();
  });
});
