import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import { keccak_256 } from '@noble/hashes/sha3';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa';
import { ml_kem768 } from '@noble/post-quantum/ml-kem';

// src/key-derive.ts
function toHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
function deriveKeypair(seed) {
  if (seed.length < 32) throw new RangeError("Seed must be at least 32 bytes");
  const dsaSeed = hkdf(sha256, seed, void 0, "veil-dsa-seed", 32);
  const kemSeed = hkdf(sha256, seed, void 0, "veil-kem-seed", 64);
  const dsaKeys = ml_dsa65.keygen(dsaSeed);
  const kemKeys = ml_kem768.keygen(kemSeed);
  const hash = keccak_256(dsaKeys.publicKey);
  const address = "0x" + toHex(hash.slice(12));
  return {
    signingKey: dsaKeys.secretKey,
    encapsulationKey: kemKeys.secretKey,
    publicKey: {
      dsa: dsaKeys.publicKey,
      kem: kemKeys.publicKey
    },
    address
  };
}
function deriveAddress(seed) {
  return deriveKeypair(seed).address;
}

export { deriveAddress, deriveKeypair };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map