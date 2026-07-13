import { describe, it, expect } from 'vitest';
import { NonceStore } from '../src/nonce.js';

describe('NonceStore', () => {
  it('returns true for a new (unseen) nonce', () => {
    const store = new NonceStore();
    expect(store.checkAndStoreNonce('abc123')).toBe(true);
  });

  it('returns false for a duplicate nonce within TTL', () => {
    const store = new NonceStore(600);
    store.checkAndStoreNonce('dup-nonce');
    expect(store.checkAndStoreNonce('dup-nonce')).toBe(false);
  });

  it('accepts a nonce after TTL expiry', async () => {
    const store = new NonceStore(0.1); // 100 ms TTL
    store.checkAndStoreNonce('expiry-test');
    await new Promise(r => setTimeout(r, 150));
    expect(store.checkAndStoreNonce('expiry-test')).toBe(true);
  });

  it('accepts multiple distinct nonces without collision', () => {
    const store = new NonceStore();
    const nonces = Array.from({ length: 20 }, (_, i) => `nonce-${i}`);
    for (const n of nonces) {
      expect(store.checkAndStoreNonce(n)).toBe(true);
    }
  });

  it('rejects duplicates while accepting new ones', () => {
    const store = new NonceStore();
    expect(store.checkAndStoreNonce('alpha')).toBe(true);
    expect(store.checkAndStoreNonce('beta')).toBe(true);
    expect(store.checkAndStoreNonce('alpha')).toBe(false);
    expect(store.checkAndStoreNonce('gamma')).toBe(true);
    expect(store.checkAndStoreNonce('beta')).toBe(false);
  });

  it('custom TTL is respected — short TTL expires faster', async () => {
    const store = new NonceStore(0.05); // 50 ms
    store.checkAndStoreNonce('short-lived');
    await new Promise(r => setTimeout(r, 100));
    expect(store.checkAndStoreNonce('short-lived')).toBe(true);
  });
});
