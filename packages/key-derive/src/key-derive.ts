/**
 * Deterministic keypair derivation from a seed using HKDF-SHA256.
 *
 * Derives:
 *   - 32 bytes  → ML-DSA-65 seed
 *   - 64 bytes  → ML-KEM-768 seed
 *
 * Address derivation matches @veil/pqc-wallet:
 *   address = "0x" + hex(keccak256(dsa.publicKey).slice(12))
 */

import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import { keccak_256 } from '@noble/hashes/sha3';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa';
import { ml_kem768 } from '@noble/post-quantum/ml-kem';
import type { PQCKeypair } from '@noisebound/pqc-wallet';

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Derive a deterministic ML-DSA-65 + ML-KEM-768 keypair from a 32-byte seed.
 * Produces identical results to @veil/pqc-wallet generatePQCKeypair() when
 * that function's RNG is replaced with this seed material.
 */
export function deriveKeypair(seed: Uint8Array): PQCKeypair {
  if (seed.length < 32) throw new RangeError('Seed must be at least 32 bytes');

  const dsaSeed = hkdf(sha256, seed, undefined, 'veil-dsa-seed', 32);
  const kemSeed = hkdf(sha256, seed, undefined, 'veil-kem-seed', 64);

  const dsaKeys = ml_dsa65.keygen(dsaSeed);
  const kemKeys = ml_kem768.keygen(kemSeed);

  const hash = keccak_256(dsaKeys.publicKey);
  const address = '0x' + toHex(hash.slice(12));

  return {
    signingKey: dsaKeys.secretKey,
    encapsulationKey: kemKeys.secretKey,
    publicKey: {
      dsa: dsaKeys.publicKey,
      kem: kemKeys.publicKey,
    },
    address,
  };
}

/**
 * Derive an EVM address from a seed — same derivation as deriveKeypair().address.
 */
export function deriveAddress(seed: Uint8Array): string {
  return deriveKeypair(seed).address;
}
