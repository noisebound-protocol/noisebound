import { describe, it, expect, beforeAll } from 'vitest';
import { generatePQCKeypair } from '@noisebound/pqc-wallet';
import type { PQCKeypair } from '@noisebound/pqc-wallet';
import { encryptPaymentMetadata, decryptPaymentMetadata } from '../src/encryption.js';

let payeeKeypair: PQCKeypair;
let otherKeypair: PQCKeypair;

beforeAll(() => {
  payeeKeypair = generatePQCKeypair();
  otherKeypair = generatePQCKeypair();
});

const sampleMetadata = {
  invoiceId: 'inv-001',
  description: 'API call payment',
  tags: ['agent', 'x402'],
};

describe('encryptPaymentMetadata', () => {
  it('returns EncryptedMetadata with all required fields', () => {
    const enc = encryptPaymentMetadata(sampleMetadata, payeeKeypair.publicKey.kem);
    expect(enc).toHaveProperty('kemCiphertext');
    expect(enc).toHaveProperty('aesCiphertext');
    expect(enc).toHaveProperty('aesNonce');
    expect(enc).toHaveProperty('payeePublicKey');
    expect(enc.kemCiphertext).toBeInstanceOf(Uint8Array);
    expect(enc.aesCiphertext).toBeInstanceOf(Uint8Array);
    expect(enc.aesNonce).toBeInstanceOf(Uint8Array);
    expect(enc.aesNonce.length).toBe(12);
  });

  it('produces different ciphertexts for the same metadata (randomised KEM)', () => {
    const enc1 = encryptPaymentMetadata(sampleMetadata, payeeKeypair.publicKey.kem);
    const enc2 = encryptPaymentMetadata(sampleMetadata, payeeKeypair.publicKey.kem);
    // KEM encapsulation is randomised, so ciphertexts differ
    expect(enc1.kemCiphertext).not.toEqual(enc2.kemCiphertext);
    expect(enc1.aesCiphertext).not.toEqual(enc2.aesCiphertext);
  });
});

describe('decryptPaymentMetadata', () => {
  it('roundtrip: decrypted metadata matches original', () => {
    const enc = encryptPaymentMetadata(sampleMetadata, payeeKeypair.publicKey.kem);
    const dec = decryptPaymentMetadata(enc, payeeKeypair.encapsulationKey);
    expect(dec).toEqual(sampleMetadata);
  });

  it('handles complex nested metadata', () => {
    const complex = {
      amount: '0.001',
      nested: { a: 1, b: [true, null, 'str'] },
      unicode: '日本語テスト',
    };
    const enc = encryptPaymentMetadata(complex, payeeKeypair.publicKey.kem);
    const dec = decryptPaymentMetadata(enc, payeeKeypair.encapsulationKey);
    expect(dec).toEqual(complex);
  });

  it('fails with the wrong private key', () => {
    const enc = encryptPaymentMetadata(sampleMetadata, payeeKeypair.publicKey.kem);
    expect(() => decryptPaymentMetadata(enc, otherKeypair.encapsulationKey)).toThrow();
  });
});
