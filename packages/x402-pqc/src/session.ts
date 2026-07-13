import { ml_dsa65 } from '@noble/post-quantum/ml-dsa';
import { encapsulateKey, decapsulateKey } from '@noisebound/pqc-wallet';
import { hkdf } from '@noble/hashes/hkdf';
import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha2';
import type { PQCKeypair, PaymentParams, VerificationResult, SessionOpenHeader, SessionConfirmation } from './types.js';
import { toHex, fromHex, timingSafeEqual, randomBytes } from './utils.js';
import { NonceStore } from './nonce.js';

const SESSION_TTL_SECS = 3600;
const TIMESTAMP_WINDOW_SECS = 300;
const SESSION_INFO = new TextEncoder().encode('x402-pqc-session-v1');

const sessionNonces = new NonceStore(SESSION_TTL_SECS * 2);

/**
 * Payer opens a session. Generates a sessionId, signs (sessionId + kemPublicKey + timestamp)
 * with ML-DSA-65. The payeeKEMPublicKey param records which payee this session is directed to.
 */
export function createSession(
  payerKeypair: PQCKeypair,
  _payeeKEMPublicKey: Uint8Array,
): SessionOpenHeader {
  const sessionId = toHex(randomBytes(32));
  const timestamp = Math.floor(Date.now() / 1000);
  const kemPublicKeyHex = toHex(payerKeypair.publicKey.kem);
  const payerPublicKeyHex = toHex(payerKeypair.publicKey.dsa);

  const enc = new TextEncoder();
  const msgToSign = enc.encode(sessionId + kemPublicKeyHex + timestamp.toString());
  const signature = ml_dsa65.sign(payerKeypair.signingKey, msgToSign);

  return {
    sessionId,
    payerPublicKey: payerPublicKeyHex,
    kemPublicKey: kemPublicKeyHex,
    timestamp,
    signature: toHex(signature),
  };
}

/**
 * Payee confirms the session. Encapsulates to the payer's KEM public key to establish
 * a shared secret, then signs (sessionId + kemCiphertext + expiry) with ML-DSA-65.
 */
export function confirmSession(
  sessionOpen: SessionOpenHeader,
  payeeKeypair: PQCKeypair,
): SessionConfirmation {
  const payerKemPublicKey = fromHex(sessionOpen.kemPublicKey);
  const { ciphertext, sharedSecret: _sharedSecret } = encapsulateKey(payerKemPublicKey);
  const kemCiphertextHex = toHex(ciphertext);
  const sessionExpiry = Math.floor(Date.now() / 1000) + SESSION_TTL_SECS;

  const enc = new TextEncoder();
  const msgToSign = enc.encode(sessionOpen.sessionId + kemCiphertextHex + sessionExpiry.toString());
  const signature = ml_dsa65.sign(payeeKeypair.signingKey, msgToSign);

  return {
    sessionId: sessionOpen.sessionId,
    kemCiphertext: kemCiphertextHex,
    sessionExpiry,
    signature: toHex(signature),
  };
}

/**
 * Both parties derive the same 32-byte session key.
 * Payer: privateKey = payerKeypair.encapsulationKey (ML-KEM-768 secret key).
 * Decapsulates confirmation.kemCiphertext → sharedSecret, then HKDF-SHA256.
 */
export function deriveSessionKey(
  sessionOpen: SessionOpenHeader,
  confirmation: SessionConfirmation,
  privateKey: Uint8Array,
): Uint8Array {
  const kemCiphertext = fromHex(confirmation.kemCiphertext);
  const sharedSecret = decapsulateKey(kemCiphertext, privateKey);
  const salt = new TextEncoder().encode(sessionOpen.sessionId);
  return hkdf(sha256, sharedSecret, salt, SESSION_INFO, 32);
}

interface SessionPaymentPayload {
  s: string; // sessionId
  n: string; // nonce (hex)
  t: number; // timestamp (unix seconds)
  a: string; // amount
  r: string; // recipient
  m: string; // HMAC-SHA256 (hex)
}

function buildMacInput(nonce: string, timestamp: number, amount: string, recipient: string): Uint8Array {
  return new TextEncoder().encode(`${nonce}\0${timestamp}\0${amount}\0${recipient}`);
}

/**
 * Creates a compact session payment header (~250–400 bytes) authenticated with HMAC-SHA256.
 * Much lighter than a full ML-DSA-65 base header (~14 KB) — suitable for high-frequency agent payments.
 */
export function createSessionPayment(
  params: PaymentParams,
  sessionKey: Uint8Array,
  sessionId: string,
): string {
  const nonce = params.nonce ?? toHex(randomBytes(16));
  const timestamp = params.timestamp ?? Math.floor(Date.now() / 1000);

  const macInput = buildMacInput(nonce, timestamp, params.amount, params.recipient);
  const mac = hmac(sha256, sessionKey, macInput);

  const payload: SessionPaymentPayload = {
    s: sessionId,
    n: nonce,
    t: timestamp,
    a: params.amount,
    r: params.recipient,
    m: toHex(mac),
  };

  return btoa(JSON.stringify(payload));
}

/**
 * Verifies a session payment header using constant-time HMAC comparison.
 * Rejects replayed nonces and timestamps outside the ±300 s window.
 */
export function verifySessionPayment(
  header: string,
  sessionKey: Uint8Array,
): VerificationResult {
  let payload: SessionPaymentPayload;
  try {
    payload = JSON.parse(atob(header)) as SessionPaymentPayload;
  } catch {
    return { valid: false, error: 'malformed header' };
  }

  const now = Math.floor(Date.now() / 1000);
  const delta = now - payload.t;
  if (delta > TIMESTAMP_WINDOW_SECS || delta < -TIMESTAMP_WINDOW_SECS) {
    return { valid: false, error: 'timestamp out of window' };
  }

  const nonceKey = `${payload.s}:${payload.n}`;
  if (!sessionNonces.checkAndStoreNonce(nonceKey)) {
    return { valid: false, error: 'replayed nonce' };
  }

  try {
    const macInput = buildMacInput(payload.n, payload.t, payload.a, payload.r);
    const expected = hmac(sha256, sessionKey, macInput);
    const actual = fromHex(payload.m);

    if (!timingSafeEqual(expected, actual)) {
      return { valid: false, error: 'invalid MAC' };
    }

    return {
      valid: true,
      amount: payload.a,
      recipient: payload.r,
      timestamp: payload.t,
    };
  } catch {
    return { valid: false, error: 'verification error' };
  }
}
