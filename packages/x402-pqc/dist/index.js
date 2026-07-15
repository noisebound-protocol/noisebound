import { ml_dsa65 } from '@noble/post-quantum/ml-dsa';
import { sha3_256, keccak_256 } from '@noble/hashes/sha3';
import { encapsulateKey, decapsulateKey, getActiveNetwork } from '@noisebound/pqc-wallet';
import { gcm } from '@noble/ciphers/aes';
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha2';
import { hmac } from '@noble/hashes/hmac';

// src/header.ts

// src/utils.ts
function toHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
function fromHex(hex) {
  if (hex.length % 2 !== 0) throw new Error("invalid hex string");
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}
function randomBytes(n) {
  return crypto.getRandomValues(new Uint8Array(n));
}

// src/header.ts
var SIGNING_ALGORITHM = "ML-DSA-65";
var SPEC_VERSION = "x402-pqc-v0.1.0";
var TIMESTAMP_WINDOW_SECS = 300;
function canonicalMessage(signingAlgorithm, publicKey, nonce, timestamp, amount, recipient, network) {
  const enc = new TextEncoder();
  const concat = enc.encode(
    signingAlgorithm + publicKey + nonce + timestamp.toString() + amount + recipient + network
  );
  return sha3_256(concat);
}
function deriveAddress(dsaPublicKeyHex) {
  const pkBytes = fromHex(dsaPublicKeyHex);
  const hash = keccak_256(pkBytes);
  return "0x" + toHex(hash.slice(12));
}
function createX402PQCHeader(params, keypair) {
  const nonce = params.nonce ?? toHex(randomBytes(16));
  const timestamp = params.timestamp ?? Math.floor(Date.now() / 1e3);
  const publicKeyHex = toHex(keypair.publicKey.dsa);
  const msgHash = canonicalMessage(
    SIGNING_ALGORITHM,
    publicKeyHex,
    nonce,
    timestamp,
    params.amount,
    params.recipient,
    params.network
  );
  const signature = ml_dsa65.sign(keypair.signingKey, msgHash);
  const header = {
    version: SPEC_VERSION,
    signingAlgorithm: SIGNING_ALGORITHM,
    publicKey: publicKeyHex,
    nonce,
    timestamp,
    amount: params.amount,
    recipient: params.recipient,
    network: params.network,
    signature: toHex(signature)
  };
  return btoa(JSON.stringify(header));
}
function verifyX402PQCHeader(header) {
  let decoded;
  try {
    decoded = JSON.parse(atob(header));
  } catch {
    return { valid: false, error: "malformed header" };
  }
  const now = Math.floor(Date.now() / 1e3);
  const delta = now - decoded.timestamp;
  if (delta > TIMESTAMP_WINDOW_SECS || delta < -TIMESTAMP_WINDOW_SECS) {
    return { valid: false, error: "timestamp out of window" };
  }
  try {
    const msgHash = canonicalMessage(
      decoded.signingAlgorithm,
      decoded.publicKey,
      decoded.nonce,
      decoded.timestamp,
      decoded.amount,
      decoded.recipient,
      decoded.network
    );
    const publicKeyBytes = fromHex(decoded.publicKey);
    const signatureBytes = fromHex(decoded.signature);
    const ok = ml_dsa65.verify(publicKeyBytes, msgHash, signatureBytes);
    if (!ok) return { valid: false, error: "invalid signature" };
    return {
      valid: true,
      payer: deriveAddress(decoded.publicKey),
      amount: decoded.amount,
      recipient: decoded.recipient,
      timestamp: decoded.timestamp
    };
  } catch {
    return { valid: false, error: "verification error" };
  }
}
var ENC_INFO = new TextEncoder().encode("x402-pqc-encryption-v1");
function deriveAesKey(sharedSecret) {
  return hkdf(sha256, sharedSecret, void 0, ENC_INFO, 32);
}
function encryptPaymentMetadata(metadata, payeePublicKey) {
  const { ciphertext: kemCiphertext, sharedSecret } = encapsulateKey(payeePublicKey);
  const aesKey = deriveAesKey(sharedSecret);
  const aesNonce = randomBytes(12);
  const plaintext = new TextEncoder().encode(JSON.stringify(metadata));
  const aesCiphertext = gcm(aesKey, aesNonce).encrypt(plaintext);
  return { kemCiphertext, aesCiphertext, aesNonce, payeePublicKey };
}
function decryptPaymentMetadata(encrypted, privateKey) {
  const sharedSecret = decapsulateKey(encrypted.kemCiphertext, privateKey);
  const aesKey = deriveAesKey(sharedSecret);
  const plaintext = gcm(aesKey, encrypted.aesNonce).decrypt(encrypted.aesCiphertext);
  return JSON.parse(new TextDecoder().decode(plaintext));
}

// src/nonce.ts
var NonceStore = class {
  store = /* @__PURE__ */ new Map();
  ttlMs;
  constructor(ttlSeconds = 600) {
    this.ttlMs = ttlSeconds * 1e3;
  }
  /**
   * Returns true and records the nonce if it has not been seen within the TTL window.
   * Returns false if the nonce was already seen (replay detected).
   */
  checkAndStoreNonce(nonce) {
    this.evict();
    if (this.store.has(nonce)) return false;
    this.store.set(nonce, Date.now());
    return true;
  }
  evict() {
    const cutoff = Date.now() - this.ttlMs;
    for (const [nonce, ts] of this.store) {
      if (ts < cutoff) this.store.delete(nonce);
    }
  }
};

// src/session.ts
var SESSION_TTL_SECS = 3600;
var TIMESTAMP_WINDOW_SECS2 = 300;
var SESSION_INFO = new TextEncoder().encode("x402-pqc-session-v1");
var sessionNonces = new NonceStore(SESSION_TTL_SECS * 2);
function createSession(payerKeypair, _payeeKEMPublicKey) {
  const sessionId = toHex(randomBytes(32));
  const timestamp = Math.floor(Date.now() / 1e3);
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
    signature: toHex(signature)
  };
}
function confirmSession(sessionOpen, payeeKeypair) {
  const payerKemPublicKey = fromHex(sessionOpen.kemPublicKey);
  const { ciphertext, sharedSecret: _sharedSecret } = encapsulateKey(payerKemPublicKey);
  const kemCiphertextHex = toHex(ciphertext);
  const sessionExpiry = Math.floor(Date.now() / 1e3) + SESSION_TTL_SECS;
  const enc = new TextEncoder();
  const msgToSign = enc.encode(sessionOpen.sessionId + kemCiphertextHex + sessionExpiry.toString());
  const signature = ml_dsa65.sign(payeeKeypair.signingKey, msgToSign);
  return {
    sessionId: sessionOpen.sessionId,
    kemCiphertext: kemCiphertextHex,
    sessionExpiry,
    signature: toHex(signature)
  };
}
function deriveSessionKey(sessionOpen, confirmation, privateKey) {
  const kemCiphertext = fromHex(confirmation.kemCiphertext);
  const sharedSecret = decapsulateKey(kemCiphertext, privateKey);
  const salt = new TextEncoder().encode(sessionOpen.sessionId);
  return hkdf(sha256, sharedSecret, salt, SESSION_INFO, 32);
}
function buildMacInput(nonce, timestamp, amount, recipient) {
  return new TextEncoder().encode(`${nonce}\0${timestamp}\0${amount}\0${recipient}`);
}
function createSessionPayment(params, sessionKey, sessionId) {
  const nonce = params.nonce ?? toHex(randomBytes(16));
  const timestamp = params.timestamp ?? Math.floor(Date.now() / 1e3);
  const macInput = buildMacInput(nonce, timestamp, params.amount, params.recipient);
  const mac = hmac(sha256, sessionKey, macInput);
  const payload = {
    s: sessionId,
    n: nonce,
    t: timestamp,
    a: params.amount,
    r: params.recipient,
    m: toHex(mac)
  };
  return btoa(JSON.stringify(payload));
}
function verifySessionPayment(header, sessionKey) {
  let payload;
  try {
    payload = JSON.parse(atob(header));
  } catch {
    return { valid: false, error: "malformed header" };
  }
  const now = Math.floor(Date.now() / 1e3);
  const delta = now - payload.t;
  if (delta > TIMESTAMP_WINDOW_SECS2 || delta < -TIMESTAMP_WINDOW_SECS2) {
    return { valid: false, error: "timestamp out of window" };
  }
  const nonceKey = `${payload.s}:${payload.n}`;
  if (!sessionNonces.checkAndStoreNonce(nonceKey)) {
    return { valid: false, error: "replayed nonce" };
  }
  try {
    const macInput = buildMacInput(payload.n, payload.t, payload.a, payload.r);
    const expected = hmac(sha256, sessionKey, macInput);
    const actual = fromHex(payload.m);
    if (!timingSafeEqual(expected, actual)) {
      return { valid: false, error: "invalid MAC" };
    }
    return {
      valid: true,
      amount: payload.a,
      recipient: payload.r,
      timestamp: payload.t
    };
  } catch {
    return { valid: false, error: "verification error" };
  }
}
var CAPABILITY_SPEC_VERSION = "x402-pqc-capability-v1";
function canonicalTokenMessage(tokenId, sessionId, scopes, issuedAt, expiresAt, executionAddress, granterPublicKey) {
  const enc = new TextEncoder();
  const concat = enc.encode(
    CAPABILITY_SPEC_VERSION + tokenId + sessionId + JSON.stringify(scopes) + issuedAt.toString() + expiresAt.toString() + executionAddress + granterPublicKey
  );
  return sha3_256(concat);
}
function issueCapabilityToken(granterKeypair, sessionId, executionAddress, scopes, ttlSeconds) {
  const tokenId = toHex(randomBytes(16));
  const issuedAt = Math.floor(Date.now() / 1e3);
  const expiresAt = issuedAt + ttlSeconds;
  const granterPublicKey = toHex(granterKeypair.publicKey.dsa);
  const msgHash = canonicalTokenMessage(
    tokenId,
    sessionId,
    scopes,
    issuedAt,
    expiresAt,
    executionAddress,
    granterPublicKey
  );
  const signature = ml_dsa65.sign(granterKeypair.signingKey, msgHash);
  return {
    tokenId,
    sessionId,
    scopes,
    issuedAt,
    expiresAt,
    executionAddress,
    granterPublicKey,
    signature: toHex(signature)
  };
}
function verifyCapabilitySignature(token) {
  try {
    const msgHash = canonicalTokenMessage(
      token.tokenId,
      token.sessionId,
      token.scopes,
      token.issuedAt,
      token.expiresAt,
      token.executionAddress,
      token.granterPublicKey
    );
    const publicKeyBytes = fromHex(token.granterPublicKey);
    const signatureBytes = fromHex(token.signature);
    return ml_dsa65.verify(publicKeyBytes, msgHash, signatureBytes);
  } catch {
    return false;
  }
}

// src/revocation.ts
var RevocationRegistry = class {
  store = /* @__PURE__ */ new Map();
  // tokenId -> natural expiresAt (unix secs)
  /** Marks a token as revoked. `expiresAt` is the token's own expiry, used to bound the sweep. */
  revoke(tokenId, expiresAt) {
    this.store.set(tokenId, expiresAt);
  }
  isRevoked(tokenId) {
    this.evict();
    return this.store.has(tokenId);
  }
  /** A revoked token can be forgotten once it would have expired naturally anyway. */
  evict() {
    const now = Math.floor(Date.now() / 1e3);
    for (const [tokenId, expiresAt] of this.store) {
      if (expiresAt < now) this.store.delete(tokenId);
    }
  }
};

// src/verify-capability.ts
function scopeSatisfies(granted, requiredScope) {
  if (granted.type !== requiredScope.type) return false;
  if (granted.type === "read-balance") return true;
  const required = requiredScope;
  if (BigInt(required.maxAmountWei) > BigInt(granted.maxAmountWei)) return false;
  if (granted.contractAddress !== void 0 && granted.contractAddress !== required.contractAddress) {
    return false;
  }
  return true;
}
function verifyCapabilityToken(token, requiredScope, registry) {
  if (!verifyCapabilitySignature(token)) {
    return { valid: false, error: "invalid signature" };
  }
  const now = Math.floor(Date.now() / 1e3);
  if (now > token.expiresAt) {
    return { valid: false, error: "token expired" };
  }
  if (registry.isRevoked(token.tokenId)) {
    return { valid: false, error: "token revoked" };
  }
  const scopeMatch = token.scopes.some((granted) => scopeSatisfies(granted, requiredScope));
  if (!scopeMatch) {
    return { valid: false, error: "out of scope" };
  }
  return { valid: true };
}
async function executeScopedTransaction(token, executionSigner, tx, registry) {
  const signerAddress = await executionSigner.getAddress();
  if (signerAddress.toLowerCase() !== token.executionAddress.toLowerCase()) {
    throw new Error("execution signer does not match token.executionAddress");
  }
  const amountWei = (tx.value ?? 0n).toString();
  const contractAddress = typeof tx.to === "string" ? tx.to : void 0;
  const result = verifyCapabilityToken(
    token,
    { type: "sign-tx", maxAmountWei: amountWei, contractAddress },
    registry
  );
  if (!result.valid) {
    throw new Error(`capability check failed: ${result.error}`);
  }
  const activeNetwork = getActiveNetwork();
  const connectedNetwork = await executionSigner.provider?.getNetwork();
  if (!connectedNetwork || Number(connectedNetwork.chainId) !== activeNetwork.chainId) {
    throw new Error(
      `execution signer is not connected to the active network (${activeNetwork.displayName}, chainId ${activeNetwork.chainId})`
    );
  }
  return executionSigner.sendTransaction(tx);
}

export { NonceStore, RevocationRegistry, SIGNING_ALGORITHM, confirmSession, createSession, createSessionPayment, createX402PQCHeader, decryptPaymentMetadata, deriveSessionKey, encryptPaymentMetadata, executeScopedTransaction, issueCapabilityToken, verifyCapabilitySignature, verifyCapabilityToken, verifySessionPayment, verifyX402PQCHeader };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map