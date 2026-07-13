import { ml_dsa65 } from '@noble/post-quantum/ml-dsa';
import type { X402PQCHeader } from './types.js';

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Creates a quantum-resistant x402 payment header signed with ML-DSA-65.
 * The payload (amount, recipient, timestamp, nonce) is signed before encoding,
 * so any field tampering invalidates the signature.
 *
 * The verifier must supply the sender's DSA public key out-of-band
 * (e.g., resolved from an on-chain registry by the sender's address).
 */
export function createX402PQCHeader(
  amount: string,
  recipient: string,
  signingKey: Uint8Array,
): string {
  const payload = {
    version: 'pqc-1',
    amount,
    recipient,
    timestamp: Date.now(),
    nonce: toHex(crypto.getRandomValues(new Uint8Array(16))),
  };

  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
  const signature = ml_dsa65.sign(signingKey, payloadBytes);

  const fullHeader: X402PQCHeader = { ...payload, signature: toHex(signature) };
  return btoa(JSON.stringify(fullHeader));
}

/**
 * Verifies a PQC-signed x402 payment header.
 * Strips the signature field, re-serializes the payload in the original key order,
 * and verifies with ML-DSA-65.
 */
export function verifyX402PQCHeader(headerB64: string, publicKey: Uint8Array): boolean {
  try {
    const full: X402PQCHeader = JSON.parse(atob(headerB64));
    const { signature, ...payload } = full;
    const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
    return ml_dsa65.verify(publicKey, payloadBytes, fromHex(signature));
  } catch {
    return false;
  }
}
