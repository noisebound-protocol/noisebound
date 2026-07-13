import { describe, it, expect, beforeAll } from 'vitest';
import { generatePQCKeypair } from '@noisebound/pqc-wallet';
import type { PQCKeypair } from '@noisebound/pqc-wallet';
import { createX402PQCHeader, verifyX402PQCHeader, SIGNING_ALGORITHM } from '../src/header.js';
import { toHex } from '../src/utils.js';

let keypair: PQCKeypair;

beforeAll(() => {
  keypair = generatePQCKeypair();
});

const params = {
  amount: '1.00',
  recipient: '0xabcdef1234567890abcdef1234567890abcdef12',
  network: 'base',
};

describe('createX402PQCHeader', () => {
  it('produces a valid base64 string', () => {
    const header = createX402PQCHeader(params, keypair);
    expect(() => atob(header)).not.toThrow();
    expect(typeof header).toBe('string');
    expect(header.length).toBeGreaterThan(0);
  });

  it('produces JSON with all required fields', () => {
    const header = createX402PQCHeader(params, keypair);
    const decoded = JSON.parse(atob(header));
    expect(decoded).toHaveProperty('version');
    expect(decoded).toHaveProperty('signingAlgorithm');
    expect(decoded).toHaveProperty('publicKey');
    expect(decoded).toHaveProperty('nonce');
    expect(decoded).toHaveProperty('timestamp');
    expect(decoded).toHaveProperty('amount', params.amount);
    expect(decoded).toHaveProperty('recipient', params.recipient);
    expect(decoded).toHaveProperty('network', params.network);
    expect(decoded).toHaveProperty('signature');
  });

  it('contains signingAlgorithm: "ML-DSA-65"', () => {
    const header = createX402PQCHeader(params, keypair);
    const decoded = JSON.parse(atob(header));
    expect(decoded.signingAlgorithm).toBe('ML-DSA-65');
    expect(decoded.signingAlgorithm).toBe(SIGNING_ALGORITHM);
  });

  it('uses provided nonce', () => {
    const nonce = 'deadbeefcafe1234deadbeefcafe1234';
    const header = createX402PQCHeader({ ...params, nonce }, keypair);
    const decoded = JSON.parse(atob(header));
    expect(decoded.nonce).toBe(nonce);
  });

  it('uses provided timestamp', () => {
    const timestamp = 1700000000;
    const header = createX402PQCHeader({ ...params, timestamp }, keypair);
    const decoded = JSON.parse(atob(header));
    expect(decoded.timestamp).toBe(timestamp);
  });

  it('generates a different nonce each call when not provided', () => {
    const h1 = createX402PQCHeader(params, keypair);
    const h2 = createX402PQCHeader(params, keypair);
    const n1 = JSON.parse(atob(h1)).nonce;
    const n2 = JSON.parse(atob(h2)).nonce;
    expect(n1).not.toBe(n2);
  });

  it('embeds the correct DSA public key', () => {
    const header = createX402PQCHeader(params, keypair);
    const decoded = JSON.parse(atob(header));
    expect(decoded.publicKey).toBe(toHex(keypair.publicKey.dsa));
  });

  it('version matches x402-pqc spec v0.1.0', () => {
    const header = createX402PQCHeader(params, keypair);
    const decoded = JSON.parse(atob(header));
    expect(decoded.version).toBe('x402-pqc-v0.1.0');
  });
});

describe('verifyX402PQCHeader', () => {
  it('returns valid=true for a correctly signed header', () => {
    const now = Math.floor(Date.now() / 1000);
    const header = createX402PQCHeader({ ...params, timestamp: now }, keypair);
    const result = verifyX402PQCHeader(header);
    expect(result.valid).toBe(true);
  });

  it('extracts correct amount and recipient', () => {
    const now = Math.floor(Date.now() / 1000);
    const header = createX402PQCHeader({ ...params, timestamp: now }, keypair);
    const result = verifyX402PQCHeader(header);
    expect(result.amount).toBe(params.amount);
    expect(result.recipient).toBe(params.recipient);
  });

  it('returns valid=false for a tampered signature', () => {
    const header = createX402PQCHeader(params, keypair);
    const decoded = JSON.parse(atob(header));
    decoded.signature = decoded.signature.replace(/^../, 'ff');
    const tampered = btoa(JSON.stringify(decoded));
    const result = verifyX402PQCHeader(tampered);
    expect(result.valid).toBe(false);
  });

  it('returns valid=false when amount is tampered', () => {
    const now = Math.floor(Date.now() / 1000);
    const header = createX402PQCHeader({ ...params, timestamp: now }, keypair);
    const decoded = JSON.parse(atob(header));
    decoded.amount = '9999.00';
    const tampered = btoa(JSON.stringify(decoded));
    const result = verifyX402PQCHeader(tampered);
    expect(result.valid).toBe(false);
  });

  it('returns valid=false for an expired timestamp (past)', () => {
    const oldTimestamp = Math.floor(Date.now() / 1000) - 400;
    const header = createX402PQCHeader({ ...params, timestamp: oldTimestamp }, keypair);
    const result = verifyX402PQCHeader(header);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('timestamp');
  });

  it('returns valid=false for a future timestamp beyond window', () => {
    const futureTimestamp = Math.floor(Date.now() / 1000) + 400;
    const header = createX402PQCHeader({ ...params, timestamp: futureTimestamp }, keypair);
    const result = verifyX402PQCHeader(header);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('timestamp');
  });

  it('returns valid=false for malformed base64', () => {
    const result = verifyX402PQCHeader('not-valid-base64!!!');
    expect(result.valid).toBe(false);
  });

  it('full flow: payer address derived from header matches keypair address', () => {
    const now = Math.floor(Date.now() / 1000);
    const header = createX402PQCHeader({ ...params, timestamp: now }, keypair);
    const result = verifyX402PQCHeader(header);
    expect(result.valid).toBe(true);
    expect(result.payer).toBe(keypair.address);
  });
});
