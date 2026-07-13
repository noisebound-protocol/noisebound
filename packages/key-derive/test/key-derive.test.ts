import { describe, it, expect } from 'vitest';
import { deriveKeypair, deriveAddress } from '../src/key-derive.js';
import { keccak_256 } from '@noble/hashes/sha3';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa';

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

const TEST_SEED = new Uint8Array(32).fill(0xab);

describe('key derivation', () => {
  it('deriveKeypair is deterministic', () => {
    const kp1 = deriveKeypair(TEST_SEED);
    const kp2 = deriveKeypair(TEST_SEED);

    expect(kp1.signingKey).toEqual(kp2.signingKey);
    expect(kp1.encapsulationKey).toEqual(kp2.encapsulationKey);
    expect(kp1.publicKey.dsa).toEqual(kp2.publicKey.dsa);
    expect(kp1.publicKey.kem).toEqual(kp2.publicKey.kem);
    expect(kp1.address).toBe(kp2.address);
  });

  it('returns correct key sizes matching @veil/pqc-wallet expectations', () => {
    const kp = deriveKeypair(TEST_SEED);

    // ML-DSA-65 sizes
    expect(kp.signingKey.length).toBe(4032);
    expect(kp.publicKey.dsa.length).toBe(1952);
    // ML-KEM-768 sizes
    expect(kp.encapsulationKey.length).toBe(2400);
    expect(kp.publicKey.kem.length).toBe(1184);
  });

  it('address derivation matches pqc-wallet algorithm: 0x + hex(keccak256(dsa.pk).slice(12))', () => {
    const kp = deriveKeypair(TEST_SEED);
    const hash = keccak_256(kp.publicKey.dsa);
    const expectedAddress = '0x' + toHex(hash.slice(12));

    expect(kp.address).toBe(expectedAddress);
    expect(kp.address).toMatch(/^0x[0-9a-f]{40}$/);
  });

  it('different seeds produce different keypairs', () => {
    const seedA = new Uint8Array(32).fill(0x01);
    const seedB = new Uint8Array(32).fill(0x02);

    const kpA = deriveKeypair(seedA);
    const kpB = deriveKeypair(seedB);

    expect(kpA.address).not.toBe(kpB.address);
    expect(kpA.signingKey).not.toEqual(kpB.signingKey);
  });

  it('ML-DSA-65 signing key is functional', () => {
    const kp = deriveKeypair(TEST_SEED);
    const msg = new TextEncoder().encode('test message');

    const sig = ml_dsa65.sign(kp.signingKey, msg);
    const valid = ml_dsa65.verify(kp.publicKey.dsa, msg, sig);
    expect(valid).toBe(true);
  });

  it('deriveAddress matches deriveKeypair().address', () => {
    const seed = new Uint8Array(32).fill(0x77);
    const kp = deriveKeypair(seed);
    const addr = deriveAddress(seed);
    expect(addr).toBe(kp.address);
  });

  it('throws on seed shorter than 32 bytes', () => {
    expect(() => deriveKeypair(new Uint8Array(16))).toThrow(RangeError);
  });
});
