import { ml_dsa65 } from '@noble/post-quantum/ml-dsa';
import { ml_kem768 } from '@noble/post-quantum/ml-kem';
import { keccak_256 } from '@noble/hashes/sha3';
import type { PQCKeypair } from './types.js';

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Generates an ML-DSA-65 signing keypair + ML-KEM-768 encapsulation keypair.
 * The address is derived as the last 20 bytes of keccak256(dsa public key),
 * analogous to how Ethereum derives addresses from ECDSA public keys.
 */
export function generatePQCKeypair(): PQCKeypair {
  // ML-DSA-65 requires a 32-byte seed; ML-KEM-768 requires a 64-byte seed
  const dsaKeys = ml_dsa65.keygen(crypto.getRandomValues(new Uint8Array(32)));
  const kemKeys = ml_kem768.keygen(crypto.getRandomValues(new Uint8Array(64)));

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
