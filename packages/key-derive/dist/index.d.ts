import { PQCKeypair } from '@noisebound/pqc-wallet';

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

/**
 * Derive a deterministic ML-DSA-65 + ML-KEM-768 keypair from a 32-byte seed.
 * Produces identical results to @veil/pqc-wallet generatePQCKeypair() when
 * that function's RNG is replaced with this seed material.
 */
declare function deriveKeypair(seed: Uint8Array): PQCKeypair;
/**
 * Derive an EVM address from a seed — same derivation as deriveKeypair().address.
 */
declare function deriveAddress(seed: Uint8Array): string;

export { deriveAddress, deriveKeypair };
