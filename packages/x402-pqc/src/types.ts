export type { PQCKeypair, PQCPublicKey } from '@noisebound/pqc-wallet';

export interface PaymentParams {
  amount: string;
  recipient: string;
  network: string;
  nonce?: string;
  timestamp?: number;
}

export interface VerificationResult {
  valid: boolean;
  payer?: string;
  amount?: string;
  recipient?: string;
  timestamp?: number;
  error?: string;
}

export interface EncryptedMetadata {
  kemCiphertext: Uint8Array;
  aesCiphertext: Uint8Array;
  aesNonce: Uint8Array;
  payeePublicKey: Uint8Array;
}

export interface SessionOpenHeader {
  sessionId: string;
  payerPublicKey: string;
  kemPublicKey: string;
  timestamp: number;
  signature: string;
}

export interface SessionConfirmation {
  sessionId: string;
  kemCiphertext: string;
  sessionExpiry: number;
  signature: string;
}

export interface X402PQCHeader {
  version: string;
  signingAlgorithm: string;
  publicKey: string;
  nonce: string;
  timestamp: number;
  amount: string;
  recipient: string;
  network: string;
  signature: string;
}

/**
 * Explicit permission grants for a capability token. There is deliberately no
 * wildcard/"full access" scope variant — every action a token authorizes must
 * match one of these shapes exactly, so default-deny is structural rather
 * than an extra runtime check that could be forgotten.
 */
export type Scope =
  | { type: 'read-balance' }
  | { type: 'sign-tx'; maxAmountWei: string; contractAddress?: string };

export interface CapabilityToken {
  tokenId: string;
  sessionId: string;
  scopes: Scope[];
  issuedAt: number;
  expiresAt: number;
  /** The ephemeral secp256k1 address this token authorizes to actually sign/broadcast. */
  executionAddress: string;
  /** Hex ML-DSA-65 public key of the granter — the token is self-contained for verification. */
  granterPublicKey: string;
  signature: string;
}
