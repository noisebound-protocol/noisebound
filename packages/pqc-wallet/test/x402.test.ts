import { describe, it, expect } from 'vitest';
import { generatePQCKeypair } from '../src/keypair.js';
import { createX402PQCHeader, verifyX402PQCHeader } from '../src/x402.js';

describe('x402-pqc header', () => {
  it('creates a valid base64-encoded header string', () => {
    const { signingKey } = generatePQCKeypair();
    const header = createX402PQCHeader('1.00', '0xDeAdBeEf', signingKey);
    expect(typeof header).toBe('string');
    expect(header.length).toBeGreaterThan(0);
    // must be valid base64
    expect(() => atob(header)).not.toThrow();
  });

  it('header decodes to correct JSON structure', () => {
    const { signingKey } = generatePQCKeypair();
    const header = createX402PQCHeader('1.00', '0xDeAdBeEf', signingKey);
    const parsed = JSON.parse(atob(header));
    expect(parsed.version).toBe('pqc-1');
    expect(parsed.amount).toBe('1.00');
    expect(parsed.recipient).toBe('0xDeAdBeEf');
    expect(typeof parsed.timestamp).toBe('number');
    expect(typeof parsed.nonce).toBe('string');
    expect(typeof parsed.signature).toBe('string');
  });

  it('verifies a valid header', () => {
    const { signingKey, publicKey } = generatePQCKeypair();
    const header = createX402PQCHeader('1.00', '0xDeAdBeEf', signingKey);
    expect(verifyX402PQCHeader(header, publicKey.dsa)).toBe(true);
  });

  it('rejects a header with tampered amount', () => {
    const { signingKey, publicKey } = generatePQCKeypair();
    const header = createX402PQCHeader('1.00', '0xDeAdBeEf', signingKey);

    const parsed = JSON.parse(atob(header));
    parsed.amount = '9999.00';
    const tampered = btoa(JSON.stringify(parsed));

    expect(verifyX402PQCHeader(tampered, publicKey.dsa)).toBe(false);
  });

  it('rejects a header verified with the wrong public key', () => {
    const { signingKey } = generatePQCKeypair();
    const { publicKey: wrongKey } = generatePQCKeypair();

    const header = createX402PQCHeader('1.00', '0xDeAdBeEf', signingKey);
    expect(verifyX402PQCHeader(header, wrongKey.dsa)).toBe(false);
  });

  it('rejects a malformed header', () => {
    const { publicKey } = generatePQCKeypair();
    expect(verifyX402PQCHeader('not-base64!!!', publicKey.dsa)).toBe(false);
  });

  it('two headers from the same key have different nonces', () => {
    const { signingKey } = generatePQCKeypair();
    const h1 = JSON.parse(atob(createX402PQCHeader('1.00', '0xDeAdBeEf', signingKey)));
    const h2 = JSON.parse(atob(createX402PQCHeader('1.00', '0xDeAdBeEf', signingKey)));
    expect(h1.nonce).not.toBe(h2.nonce);
  });
});
