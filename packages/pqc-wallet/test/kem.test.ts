import { describe, it, expect } from 'vitest';
import { generatePQCKeypair } from '../src/keypair.js';
import { encapsulateKey, decapsulateKey } from '../src/kem.js';

describe('ML-KEM-768 encapsulate / decapsulate', () => {
  it('encapsulate and decapsulate roundtrip — shared secrets match', () => {
    const { publicKey, encapsulationKey } = generatePQCKeypair();
    const { ciphertext, sharedSecret: ss1 } = encapsulateKey(publicKey.kem);
    const ss2 = decapsulateKey(ciphertext, encapsulationKey);
    expect(ss1).toEqual(ss2);
  });

  it('shared secret is 32 bytes', () => {
    const { publicKey } = generatePQCKeypair();
    const { sharedSecret } = encapsulateKey(publicKey.kem);
    expect(sharedSecret.length).toBe(32);
  });

  it('ciphertext is 1088 bytes for ML-KEM-768', () => {
    const { publicKey } = generatePQCKeypair();
    const { ciphertext } = encapsulateKey(publicKey.kem);
    expect(ciphertext.length).toBe(1088);
  });

  it('different encapsulations produce different shared secrets', () => {
    const { publicKey } = generatePQCKeypair();
    const { sharedSecret: ss1 } = encapsulateKey(publicKey.kem);
    const { sharedSecret: ss2 } = encapsulateKey(publicKey.kem);
    expect(ss1).not.toEqual(ss2);
  });

  it('wrong decapsulation key produces different shared secret', () => {
    const { publicKey } = generatePQCKeypair();
    const { encapsulationKey: wrongKey } = generatePQCKeypair();
    const { ciphertext, sharedSecret: ss1 } = encapsulateKey(publicKey.kem);
    // ML-KEM is a KEM, not encryption — decapsulate with wrong key returns
    // a deterministic but different value (implicit rejection)
    const ss2 = decapsulateKey(ciphertext, wrongKey);
    expect(ss1).not.toEqual(ss2);
  });
});
