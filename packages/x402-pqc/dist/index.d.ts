import { PQCKeypair } from '@noisebound/pqc-wallet';
export { PQCKeypair } from '@noisebound/pqc-wallet';
import { ethers } from 'ethers';

interface PaymentParams {
    amount: string;
    recipient: string;
    network: string;
    nonce?: string;
    timestamp?: number;
}
interface VerificationResult {
    valid: boolean;
    payer?: string;
    amount?: string;
    recipient?: string;
    timestamp?: number;
    error?: string;
}
interface EncryptedMetadata {
    kemCiphertext: Uint8Array;
    aesCiphertext: Uint8Array;
    aesNonce: Uint8Array;
    payeePublicKey: Uint8Array;
}
interface SessionOpenHeader {
    sessionId: string;
    payerPublicKey: string;
    kemPublicKey: string;
    timestamp: number;
    signature: string;
}
interface SessionConfirmation {
    sessionId: string;
    kemCiphertext: string;
    sessionExpiry: number;
    signature: string;
}
interface X402PQCHeader {
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
type Scope = {
    type: 'read-balance';
} | {
    type: 'sign-tx';
    maxAmountWei: string;
    contractAddress?: string;
};
interface CapabilityToken {
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

declare const SIGNING_ALGORITHM = "ML-DSA-65";
/**
 * Creates a quantum-resistant x402-pqc payment header (spec v0.1.0).
 * The canonical message is SHA3-256(signingAlgorithm || publicKey || nonce || timestamp || amount || recipient || network).
 * Signed with ML-DSA-65. Returns base64-encoded JSON.
 */
declare function createX402PQCHeader(params: PaymentParams, keypair: PQCKeypair): string;
/**
 * Verifies an x402-pqc payment header. Checks timestamp window (±300 s) then verifies ML-DSA-65 signature.
 * Returns { valid, payer (EVM address), amount, recipient, timestamp } on success.
 */
declare function verifyX402PQCHeader(header: string): VerificationResult;

/**
 * Encrypts arbitrary payment metadata for a specific payee using ML-KEM-768 + AES-256-GCM.
 * The payeePublicKey is the recipient's ML-KEM-768 encapsulation (public) key.
 */
declare function encryptPaymentMetadata(metadata: object, payeePublicKey: Uint8Array): EncryptedMetadata;
/**
 * Decrypts payment metadata using the payee's ML-KEM-768 secret key.
 * Throws if decapsulation or AES-GCM authentication fails.
 */
declare function decryptPaymentMetadata(encrypted: EncryptedMetadata, privateKey: Uint8Array): object;

/**
 * Payer opens a session. Generates a sessionId, signs (sessionId + kemPublicKey + timestamp)
 * with ML-DSA-65. The payeeKEMPublicKey param records which payee this session is directed to.
 */
declare function createSession(payerKeypair: PQCKeypair, _payeeKEMPublicKey: Uint8Array): SessionOpenHeader;
/**
 * Payee confirms the session. Encapsulates to the payer's KEM public key to establish
 * a shared secret, then signs (sessionId + kemCiphertext + expiry) with ML-DSA-65.
 */
declare function confirmSession(sessionOpen: SessionOpenHeader, payeeKeypair: PQCKeypair): SessionConfirmation;
/**
 * Both parties derive the same 32-byte session key.
 * Payer: privateKey = payerKeypair.encapsulationKey (ML-KEM-768 secret key).
 * Decapsulates confirmation.kemCiphertext → sharedSecret, then HKDF-SHA256.
 */
declare function deriveSessionKey(sessionOpen: SessionOpenHeader, confirmation: SessionConfirmation, privateKey: Uint8Array): Uint8Array;
/**
 * Creates a compact session payment header (~250–400 bytes) authenticated with HMAC-SHA256.
 * Much lighter than a full ML-DSA-65 base header (~14 KB) — suitable for high-frequency agent payments.
 */
declare function createSessionPayment(params: PaymentParams, sessionKey: Uint8Array, sessionId: string): string;
/**
 * Verifies a session payment header using constant-time HMAC comparison.
 * Rejects replayed nonces and timestamps outside the ±300 s window.
 */
declare function verifySessionPayment(header: string, sessionKey: Uint8Array): VerificationResult;

/** In-memory nonce store for replay prevention. Production deployments need a persistent store. */
declare class NonceStore {
    private readonly store;
    private readonly ttlMs;
    constructor(ttlSeconds?: number);
    /**
     * Returns true and records the nonce if it has not been seen within the TTL window.
     * Returns false if the nonce was already seen (replay detected).
     */
    checkAndStoreNonce(nonce: string): boolean;
    private evict;
}

/**
 * Grants an ephemeral execution key a scoped, time-boxed capability, signed by
 * the long-lived ML-DSA-65 identity. The execution key never receives a
 * standing/unscoped grant — every scope must be explicitly listed.
 */
declare function issueCapabilityToken(granterKeypair: PQCKeypair, sessionId: string, executionAddress: string, scopes: Scope[], ttlSeconds: number): CapabilityToken;
/** Re-derives the canonical message for a token and checks its ML-DSA-65 signature. */
declare function verifyCapabilitySignature(token: CapabilityToken): boolean;

/**
 * In-memory revocation registry for capability tokens. Structurally parallel
 * to NonceStore: production deployments need a persistent, shared store —
 * this is single-process only.
 */
declare class RevocationRegistry {
    private readonly store;
    /** Marks a token as revoked. `expiresAt` is the token's own expiry, used to bound the sweep. */
    revoke(tokenId: string, expiresAt: number): void;
    isRevoked(tokenId: string): boolean;
    /** A revoked token can be forgotten once it would have expired naturally anyway. */
    private evict;
}

/**
 * Fail-closed capability verification: signature, then expiry, then
 * revocation, then an exact scope match. Any failure denies — there is no
 * fallback "allow" path.
 */
declare function verifyCapabilityToken(token: CapabilityToken, requiredScope: Scope, registry: RevocationRegistry): VerificationResult;

/**
 * The only sanctioned path from a capability token to an on-chain broadcast.
 * Verifies the execution signer matches the token's authorized address, that
 * the signer is actually connected to the active network (never assume — a
 * misconfigured signer could otherwise broadcast to the wrong chain, e.g.
 * mainnet when the app believes it's on testnet), and that the token grants
 * a sign-tx scope covering this exact transaction. Only then does it send.
 * Throws on any failure — callers must not fall back to a raw signer call.
 */
declare function executeScopedTransaction(token: CapabilityToken, executionSigner: ethers.Signer, tx: ethers.TransactionRequest, registry: RevocationRegistry): Promise<ethers.TransactionResponse>;

export { type CapabilityToken, type EncryptedMetadata, NonceStore, type PaymentParams, RevocationRegistry, SIGNING_ALGORITHM, type Scope, type SessionConfirmation, type SessionOpenHeader, type VerificationResult, type X402PQCHeader, confirmSession, createSession, createSessionPayment, createX402PQCHeader, decryptPaymentMetadata, deriveSessionKey, encryptPaymentMetadata, executeScopedTransaction, issueCapabilityToken, verifyCapabilitySignature, verifyCapabilityToken, verifySessionPayment, verifyX402PQCHeader };
