import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa';
import { sha256 } from '@noble/hashes/sha2';
import { generatePQCKeypair, encapsulateKey, decapsulateKey, type PQCKeypair } from '@noisebound/pqc-wallet';

/**
 * Hybrid KEM-DEM envelope. @veil/pqc-wallet only exposes raw ML-KEM-768
 * encapsulation (a shared secret, not payload encryption) and EVM-transaction
 * shaped ML-DSA-65 signing, so this module supplies the missing pieces
 * directly: the encapsulated shared secret keys an AES-256-GCM DEM that does
 * the actual payload encryption, and ML-DSA-65 signs the payload hash
 * (not an EVM transaction). AES-256-GCM is itself considered quantum-safe
 * for symmetric use (Grover's algorithm only halves its effective security).
 */

const REPLAY_WINDOW_MS = 5 * 60 * 1000;
const MAX_AUDIT_ENTRIES = 1000;

export interface PQCEnvelope {
  kemCiphertext: string;
  encryptedPayload: string;
  senderPublicKey: string;
  signature: string;
  timestamp: number;
  version: '1.0';
}

export interface PQCAuditEntry {
  timestamp: number;
  operation: 'seal' | 'unseal' | 'verify' | 'broadcast';
  payloadType: string;
  kemAlgorithm: 'ML-KEM-768';
  sigAlgorithm: 'ML-DSA-65';
  success: boolean;
}

/** In-memory only — never persisted, never transmitted, cleared on restart. */
export const auditLog: PQCAuditEntry[] = [];

export function getAuditLog(): PQCAuditEntry[] {
  return [...auditLog];
}

function recordAudit(entry: PQCAuditEntry): void {
  auditLog.push(entry);
  if (auditLog.length > MAX_AUDIT_ENTRIES) {
    auditLog.splice(0, auditLog.length - MAX_AUDIT_ENTRIES);
  }
}

interface SerializedPublicKey {
  dsa: string;
  kem: string;
}

function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

function fromHex(hex: string): Uint8Array {
  return new Uint8Array(Buffer.from(hex, 'hex'));
}

export function encodePublicKey(publicKey: PQCKeypair['publicKey']): string {
  const serialized: SerializedPublicKey = { dsa: toHex(publicKey.dsa), kem: toHex(publicKey.kem) };
  return Buffer.from(JSON.stringify(serialized)).toString('base64');
}

function decodePublicKey(encoded: string): SerializedPublicKey {
  return JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) as SerializedPublicKey;
}

/**
 * Round-trips a full PQCKeypair to a hex blob and back. There is no API to
 * derive a keypair from a seed or to recover public keys from secret keys
 * alone, so "restoring from an existing private key" means reconstructing a
 * previously generated keypair from this serialized form, not regenerating
 * fresh keys.
 */
function serializeKeypair(keypair: PQCKeypair): string {
  return Buffer.from(
    JSON.stringify({
      signingKey: toHex(keypair.signingKey),
      encapsulationKey: toHex(keypair.encapsulationKey),
      dsa: toHex(keypair.publicKey.dsa),
      kem: toHex(keypair.publicKey.kem),
      address: keypair.address,
    }),
  ).toString('hex');
}

function deserializeKeypair(blob: string): PQCKeypair {
  const parsed = JSON.parse(Buffer.from(blob, 'hex').toString('utf8')) as {
    signingKey: string;
    encapsulationKey: string;
    dsa: string;
    kem: string;
    address: string;
  };
  return {
    signingKey: fromHex(parsed.signingKey),
    encapsulationKey: fromHex(parsed.encapsulationKey),
    publicKey: { dsa: fromHex(parsed.dsa), kem: fromHex(parsed.kem) },
    address: parsed.address,
  };
}

function aesEncrypt(key: Uint8Array, plaintext: Uint8Array): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]);
}

function aesDecrypt(key: Uint8Array, sealed: Buffer): Buffer {
  const iv = sealed.subarray(0, 12);
  const authTag = sealed.subarray(12, 28);
  const ciphertext = sealed.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export class PQCTransport {
  // A keypair always exists from construction so seal()/getPublicKey() work
  // immediately; init() exists to swap in a persisted identity later.
  private keypair: PQCKeypair = generatePQCKeypair();

  async init(existingPrivateKey?: string): Promise<void> {
    this.keypair = existingPrivateKey ? deserializeKeypair(existingPrivateKey) : generatePQCKeypair();
  }

  get isInitialized(): boolean {
    return true;
  }

  /** Serializes this node's keypair for persistence (see deserializeKeypair). */
  exportPrivateKey(): string {
    return serializeKeypair(this.requireKeypair());
  }

  getPublicKey(): string {
    return encodePublicKey(this.requireKeypair().publicKey);
  }

  async seal(payload: unknown, recipientPublicKey: string): Promise<PQCEnvelope> {
    const keypair = this.requireKeypair();
    const recipient = decodePublicKey(recipientPublicKey);

    const json = JSON.stringify(payload);
    const { ciphertext, sharedSecret } = encapsulateKey(fromHex(recipient.kem));
    const encryptedPayload = aesEncrypt(sharedSecret, new TextEncoder().encode(json)).toString('base64');

    const signature = ml_dsa65.sign(keypair.signingKey, sha256(new TextEncoder().encode(encryptedPayload)));

    const envelope: PQCEnvelope = {
      kemCiphertext: Buffer.from(ciphertext).toString('base64'),
      encryptedPayload,
      senderPublicKey: this.getPublicKey(),
      signature: toHex(signature),
      timestamp: Date.now(),
      version: '1.0',
    };

    recordAudit({
      timestamp: envelope.timestamp,
      operation: 'seal',
      payloadType: typeof payload,
      kemAlgorithm: 'ML-KEM-768',
      sigAlgorithm: 'ML-DSA-65',
      success: true,
    });

    return envelope;
  }

  async unseal(envelope: PQCEnvelope): Promise<unknown> {
    const keypair = this.requireKeypair();
    let success = false;
    try {
      const verified = await this.verify(envelope, envelope.senderPublicKey);
      if (!verified) {
        throw new Error('PQCTransport.unseal: signature verification failed');
      }
      if (Date.now() - envelope.timestamp > REPLAY_WINDOW_MS) {
        throw new Error('PQCTransport.unseal: envelope expired (possible replay)');
      }

      const kemCiphertext = new Uint8Array(Buffer.from(envelope.kemCiphertext, 'base64'));
      const sharedSecret = decapsulateKey(kemCiphertext, keypair.encapsulationKey);
      const sealed = Buffer.from(envelope.encryptedPayload, 'base64');
      const plaintext = aesDecrypt(sharedSecret, sealed);
      const payload = JSON.parse(plaintext.toString('utf8'));

      success = true;
      return payload;
    } finally {
      recordAudit({
        timestamp: Date.now(),
        operation: 'unseal',
        payloadType: 'unknown',
        kemAlgorithm: 'ML-KEM-768',
        sigAlgorithm: 'ML-DSA-65',
        success,
      });
    }
  }

  async verify(envelope: PQCEnvelope, senderPublicKey: string): Promise<boolean> {
    const sender = decodePublicKey(senderPublicKey);
    const hash = sha256(new TextEncoder().encode(envelope.encryptedPayload));
    let success = false;
    try {
      success = ml_dsa65.verify(fromHex(sender.dsa), hash, fromHex(envelope.signature));
      return success;
    } catch {
      success = false;
      return false;
    } finally {
      recordAudit({
        timestamp: Date.now(),
        operation: 'verify',
        payloadType: 'envelope',
        kemAlgorithm: 'ML-KEM-768',
        sigAlgorithm: 'ML-DSA-65',
        success,
      });
    }
  }

  /** Records a broadcast audit entry (the broadcast itself reuses seal() for the envelope). */
  recordBroadcast(payloadType: string, success: boolean): void {
    recordAudit({
      timestamp: Date.now(),
      operation: 'broadcast',
      payloadType,
      kemAlgorithm: 'ML-KEM-768',
      sigAlgorithm: 'ML-DSA-65',
      success,
    });
  }

  /** Signs an arbitrary hash (e.g. a model commitment) with this node's ML-DSA-65 key. */
  signHash(hashHex: string): string {
    const keypair = this.requireKeypair();
    const signature = ml_dsa65.sign(keypair.signingKey, fromHex(hashHex));
    return toHex(signature);
  }

  private requireKeypair(): PQCKeypair {
    if (!this.keypair) {
      throw new Error('PQCTransport: call init() before use');
    }
    return this.keypair;
  }
}

/** Singleton transport instance for this node. */
export const pqcTransport = new PQCTransport();
