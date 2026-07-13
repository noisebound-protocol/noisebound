import { ml_dsa65 } from '@noble/post-quantum/ml-dsa';
import { keccak_256 } from '@noble/hashes/sha3';
import { ethers } from 'ethers';

/**
 * Signs an EVM transaction with ML-DSA-65.
 * Serializes the unsigned transaction, hashes with keccak256, then signs.
 * Returns raw ML-DSA-65 signature bytes (not EVM-compatible — for PQC chains).
 */
export function signTransaction(
  tx: ethers.TransactionLike,
  signingKey: Uint8Array,
): Uint8Array {
  const txObj = ethers.Transaction.from(tx);
  const txBytes = ethers.getBytes(txObj.unsignedSerialized);
  const msgHash = keccak_256(txBytes);
  return ml_dsa65.sign(signingKey, msgHash);
}

/**
 * Verifies an ML-DSA-65 signature over a serialized EVM transaction.
 */
export function verifyTransactionSignature(
  tx: ethers.TransactionLike,
  signature: Uint8Array,
  publicKey: Uint8Array,
): boolean {
  const txObj = ethers.Transaction.from(tx);
  const txBytes = ethers.getBytes(txObj.unsignedSerialized);
  const msgHash = keccak_256(txBytes);
  return ml_dsa65.verify(publicKey, msgHash, signature);
}
