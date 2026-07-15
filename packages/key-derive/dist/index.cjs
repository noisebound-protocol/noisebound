'use strict';

var hkdf = require('@noble/hashes/hkdf');
var sha256 = require('@noble/hashes/sha256');
var sha3 = require('@noble/hashes/sha3');
var mlDsa = require('@noble/post-quantum/ml-dsa');
var mlKem = require('@noble/post-quantum/ml-kem');

// src/key-derive.ts
function toHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
function deriveKeypair(seed) {
  if (seed.length < 32) throw new RangeError("Seed must be at least 32 bytes");
  const dsaSeed = hkdf.hkdf(sha256.sha256, seed, void 0, "veil-dsa-seed", 32);
  const kemSeed = hkdf.hkdf(sha256.sha256, seed, void 0, "veil-kem-seed", 64);
  const dsaKeys = mlDsa.ml_dsa65.keygen(dsaSeed);
  const kemKeys = mlKem.ml_kem768.keygen(kemSeed);
  const hash = sha3.keccak_256(dsaKeys.publicKey);
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

exports.deriveAddress = deriveAddress;
exports.deriveKeypair = deriveKeypair;
//# sourceMappingURL=index.cjs.map
//# sourceMappingURL=index.cjs.map