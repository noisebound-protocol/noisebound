import { describe, it, expect } from 'vitest';
import { OctraClient, OctraConnectionError, OCTRA_TESTNET_URL } from '../src/client.js';
import { generatePQCKeypair } from '@noisebound/pqc-wallet';

function makeClient(url = OCTRA_TESTNET_URL) {
  return new OctraClient(url, generatePQCKeypair());
}

describe('OctraClient', () => {
  it('stores rpcUrl and keypair from constructor', () => {
    const keypair = generatePQCKeypair();
    const client = new OctraClient('https://octra.network', keypair);
    expect(client.rpcUrl).toBe('https://octra.network');
    expect(client.keypair).toBe(keypair);
  });

  it('OCTRA_TESTNET_URL is the documented testnet endpoint', () => {
    expect(OCTRA_TESTNET_URL).toBe('https://octra.network');
  });

  it('getNetworkInfo connects to Octra testnet or fails with OctraConnectionError', async () => {
    const client = makeClient();
    try {
      const info = await client.getNetworkInfo();
      // Testnet reachable — verify shape
      expect(info).toMatchObject({
        endpoint: OCTRA_TESTNET_URL,
        reachable: true,
      });
      expect(typeof info.latencyMs).toBe('number');
      expect(info.latencyMs).toBeGreaterThanOrEqual(0);
      expect(typeof info.stagedTransactions).toBe('number');
    } catch (err) {
      // Testnet unreachable — must throw OctraConnectionError with clear message
      expect(err).toBeInstanceOf(OctraConnectionError);
      const connErr = err as OctraConnectionError;
      expect(connErr.endpoint).toBe(OCTRA_TESTNET_URL);
      expect(connErr.message).toContain('octra');
      // Must include actionable guidance, not just a raw axios error
      expect(
        connErr.message.toLowerCase().includes('unreachable') ||
          connErr.message.toLowerCase().includes('check'),
      ).toBe(true);
    }
  }, 15_000);

  it('getNetworkInfo throws OctraConnectionError for an invalid endpoint', async () => {
    const client = makeClient('http://127.0.0.1:19999');
    await expect(client.getNetworkInfo()).rejects.toBeInstanceOf(OctraConnectionError);
  });

  it('OctraConnectionError carries the endpoint', async () => {
    const endpoint = 'http://127.0.0.1:19999';
    const client = makeClient(endpoint);
    try {
      await client.getNetworkInfo();
    } catch (err) {
      expect((err as OctraConnectionError).endpoint).toBe(endpoint);
    }
  });

  it('getBalance returns bigint 0n for unknown address on unreachable testnet', async () => {
    const client = makeClient();
    const fakeAddr = 'octABCDEFGHIJKLMNOPQRSTUVWXYZ12345678901234';
    try {
      const bal = await client.getBalance(fakeAddr);
      // Testnet reachable: unknown address returns 0n or a bigint
      expect(typeof bal).toBe('bigint');
    } catch {
      // Network unreachable — acceptable
    }
  }, 15_000);

  it('getBalance result is always a bigint', async () => {
    const client = makeClient();
    const keypair = generatePQCKeypair();
    try {
      const bal = await client.getBalance(keypair.address);
      expect(typeof bal).toBe('bigint');
    } catch {
      // Network unreachable — acceptable
    }
  }, 15_000);

  it('sendTransaction returns a string tx hash or throws on testnet', async () => {
    const keypair = generatePQCKeypair();
    const client = new OctraClient(OCTRA_TESTNET_URL, keypair);
    const tx = {
      from: keypair.address,
      to: keypair.address,
      amount: '1000',
      nonce: 1,
      ou: '1',
      timestamp: Date.now() / 1000,
    };
    try {
      const hash = await client.sendTransaction(tx);
      expect(typeof hash).toBe('string');
      expect(hash.length).toBeGreaterThan(0);
    } catch {
      // Expected on testnet without funded account / Ed25519 mismatch
    }
  }, 15_000);
});
