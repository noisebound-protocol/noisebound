import { describe, it, expect } from 'vitest';
import { generatePQCKeypair } from '../src/keypair.js';

describe('generatePQCKeypair', () => {
  it('produces valid ML-DSA-65 and ML-KEM-768 keys', () => {
    const keypair = generatePQCKeypair();
    expect(keypair.signingKey).toBeInstanceOf(Uint8Array);
    expect(keypair.publicKey.dsa).toBeInstanceOf(Uint8Array);
    expect(keypair.encapsulationKey).toBeInstanceOf(Uint8Array);
    expect(keypair.publicKey.kem).toBeInstanceOf(Uint8Array);
  });

  it('derives a valid EVM-style address', () => {
    const { address } = generatePQCKeypair();
    expect(address).toMatch(/^0x[0-9a-f]{40}$/i);
  });

  it('ML-DSA-65 public key is 1952 bytes', () => {
    const { publicKey } = generatePQCKeypair();
    expect(publicKey.dsa.length).toBe(1952);
  });

  it('ML-DSA-65 secret key is 4032 bytes', () => {
    const { signingKey } = generatePQCKeypair();
    expect(signingKey.length).toBe(4032);
  });

  it('ML-KEM-768 public key is 1184 bytes', () => {
    const { publicKey } = generatePQCKeypair();
    expect(publicKey.kem.length).toBe(1184);
  });

  it('ML-KEM-768 secret key is 2400 bytes', () => {
    const { encapsulationKey } = generatePQCKeypair();
    expect(encapsulationKey.length).toBe(2400);
  });

  it('every call generates a unique keypair', () => {
    const kp1 = generatePQCKeypair();
    const kp2 = generatePQCKeypair();
    expect(kp1.address).not.toBe(kp2.address);
  });
});
