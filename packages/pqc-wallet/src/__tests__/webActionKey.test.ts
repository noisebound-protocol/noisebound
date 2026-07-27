import { describe, expect, it } from 'vitest';
import { generateWebActionKey } from '../webActionKey.js';

describe('generateWebActionKey', () => {
  it('produces a base64-encoded ECDSA P-256 keypair', async () => {
    const webActionKey = await generateWebActionKey();

    expect(webActionKey.publicKey).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
    expect(webActionKey.privateKey).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
  });

  it('produces distinct keys on each call', async () => {
    const first = await generateWebActionKey();
    const second = await generateWebActionKey();

    expect(first.publicKey).not.toBe(second.publicKey);
    expect(first.privateKey).not.toBe(second.privateKey);
  });
});
