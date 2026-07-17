import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createMemoryEntry, decryptMemoryEntry, deriveMemoryEncryptionKey, encryptMemoryEntry } from '../src/index.js';
import type { Clock } from '../src/index.js';

const fixedClock: Clock = { now: () => 1_700_000_000_000 };

describe('deriveMemoryEncryptionKey', () => {
  it('derives a 32-byte key', () => {
    const key = deriveMemoryEncryptionKey(randomBytes(32));
    expect(key.length).toBe(32);
  });

  it('is deterministic for the same seed material', () => {
    const seed = randomBytes(32);
    expect(deriveMemoryEncryptionKey(seed)).toEqual(deriveMemoryEncryptionKey(seed));
  });

  it('derives different keys from different seed material', () => {
    expect(deriveMemoryEncryptionKey(randomBytes(32))).not.toEqual(deriveMemoryEncryptionKey(randomBytes(32)));
  });
});

describe('encryptMemoryEntry / decryptMemoryEntry', () => {
  it('round-trips: decrypted entry exactly matches the original content', () => {
    const key = deriveMemoryEncryptionKey(randomBytes(32));
    const entry = createMemoryEntry(fixedClock, {
      id: 'mem-1',
      content: 'The user prefers TypeScript strict mode.',
      embedding: [0.1, -0.2, 0.3],
    });

    const encrypted = encryptMemoryEntry(entry, key);
    const decrypted = decryptMemoryEntry(encrypted, key);

    expect(decrypted).toEqual(entry);
  });

  it('produces different ciphertext for two encryptions of the same content (nonce uniqueness)', () => {
    const key = deriveMemoryEncryptionKey(randomBytes(32));
    const entry = createMemoryEntry(fixedClock, { id: 'mem-1', content: 'repeat me' });

    const first = encryptMemoryEntry(entry, key);
    const second = encryptMemoryEntry(entry, key);

    expect(first.nonce).not.toEqual(second.nonce);
    expect(first.ciphertext).not.toEqual(second.ciphertext);
  });

  it('throws instead of returning garbage when the ciphertext is tampered with', () => {
    const key = deriveMemoryEncryptionKey(randomBytes(32));
    const entry = createMemoryEntry(fixedClock, { id: 'mem-1', content: 'sensitive fact' });
    const encrypted = encryptMemoryEntry(entry, key);

    const tampered = { ...encrypted, ciphertext: new Uint8Array(encrypted.ciphertext) };
    tampered.ciphertext[0] = (tampered.ciphertext[0] ?? 0) ^ 0xff;

    expect(() => decryptMemoryEntry(tampered, key)).toThrow();
  });

  it('throws instead of returning garbage when the auth tag is tampered with', () => {
    const key = deriveMemoryEncryptionKey(randomBytes(32));
    const entry = createMemoryEntry(fixedClock, { id: 'mem-1', content: 'sensitive fact' });
    const encrypted = encryptMemoryEntry(entry, key);

    const tampered = { ...encrypted, authTag: new Uint8Array(encrypted.authTag) };
    tampered.authTag[0] = (tampered.authTag[0] ?? 0) ^ 0xff;

    expect(() => decryptMemoryEntry(tampered, key)).toThrow();
  });

  it('throws when decrypting with the wrong key', () => {
    const key = deriveMemoryEncryptionKey(randomBytes(32));
    const wrongKey = deriveMemoryEncryptionKey(randomBytes(32));
    const entry = createMemoryEntry(fixedClock, { id: 'mem-1', content: 'sensitive fact' });
    const encrypted = encryptMemoryEntry(entry, key);

    expect(() => decryptMemoryEntry(encrypted, wrongKey)).toThrow();
  });
});
