import { ml_dsa65 } from '@noble/post-quantum/ml-dsa';
import { sha3_256 } from '@noble/hashes/sha3';
import { keccak_256 } from '@noble/hashes/sha3';
import type { PQCKeypair, PaymentParams, VerificationResult, X402PQCHeader } from './types.js';
import { toHex, fromHex, randomBytes } from './utils.js';

export const SIGNING_ALGORITHM = 'ML-DSA-65';
const SPEC_VERSION = 'x402-pqc-v0.1.0';
const TIMESTAMP_WINDOW_SECS = 300;

function canonicalMessage(
  signingAlgorithm: string,
  publicKey: string,
  nonce: string,
  timestamp: number,
  amount: string,
  recipient: string,
  network: string,
): Uint8Array {
  const enc = new TextEncoder();
  const concat = enc.encode(
    signingAlgorithm + publicKey + nonce + timestamp.toString() + amount + recipient + network,
  );
  return sha3_256(concat);
}

function deriveAddress(dsaPublicKeyHex: string): string {
  const pkBytes = fromHex(dsaPublicKeyHex);
  const hash = keccak_256(pkBytes);
  return '0x' + toHex(hash.slice(12));
}

/**
 * Creates a quantum-resistant x402-pqc payment header (spec v0.1.0).
 * The canonical message is SHA3-256(signingAlgorithm || publicKey || nonce || timestamp || amount || recipient || network).
 * Signed with ML-DSA-65. Returns base64-encoded JSON.
 */
export function createX402PQCHeader(params: PaymentParams, keypair: PQCKeypair): string {
  const nonce = params.nonce ?? toHex(randomBytes(16));
  const timestamp = params.timestamp ?? Math.floor(Date.now() / 1000);
  const publicKeyHex = toHex(keypair.publicKey.dsa);

  const msgHash = canonicalMessage(
    SIGNING_ALGORITHM,
    publicKeyHex,
    nonce,
    timestamp,
    params.amount,
    params.recipient,
    params.network,
  );

  const signature = ml_dsa65.sign(keypair.signingKey, msgHash);

  const header: X402PQCHeader = {
    version: SPEC_VERSION,
    signingAlgorithm: SIGNING_ALGORITHM,
    publicKey: publicKeyHex,
    nonce,
    timestamp,
    amount: params.amount,
    recipient: params.recipient,
    network: params.network,
    signature: toHex(signature),
  };

  return btoa(JSON.stringify(header));
}

/**
 * Verifies an x402-pqc payment header. Checks timestamp window (±300 s) then verifies ML-DSA-65 signature.
 * Returns { valid, payer (EVM address), amount, recipient, timestamp } on success.
 */
export function verifyX402PQCHeader(header: string): VerificationResult {
  let decoded: X402PQCHeader;
  try {
    decoded = JSON.parse(atob(header)) as X402PQCHeader;
  } catch {
    return { valid: false, error: 'malformed header' };
  }

  const now = Math.floor(Date.now() / 1000);
  const delta = now - decoded.timestamp;
  if (delta > TIMESTAMP_WINDOW_SECS || delta < -TIMESTAMP_WINDOW_SECS) {
    return { valid: false, error: 'timestamp out of window' };
  }

  try {
    const msgHash = canonicalMessage(
      decoded.signingAlgorithm,
      decoded.publicKey,
      decoded.nonce,
      decoded.timestamp,
      decoded.amount,
      decoded.recipient,
      decoded.network,
    );

    const publicKeyBytes = fromHex(decoded.publicKey);
    const signatureBytes = fromHex(decoded.signature);
    const ok = ml_dsa65.verify(publicKeyBytes, msgHash, signatureBytes);

    if (!ok) return { valid: false, error: 'invalid signature' };

    return {
      valid: true,
      payer: deriveAddress(decoded.publicKey),
      amount: decoded.amount,
      recipient: decoded.recipient,
      timestamp: decoded.timestamp,
    };
  } catch {
    return { valid: false, error: 'verification error' };
  }
}
