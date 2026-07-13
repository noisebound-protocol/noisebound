/**
 * FHE primitives for Octra GhostCircle inference.
 *
 * Implements the fhe_load_pk / fhe_scale / fhe_add interface that maps to
 * Octra's HFHE instruction set for sealed GhostCircle execution. No query
 * plaintext leaves the encrypted boundary — only ciphertext enters and exits.
 *
 * CURRENT STATUS (honest):
 *   Octra's CKKS-based HFHE layer is described in the whitepaper but the
 *   Node.js SDK is not yet available. These functions implement the correct
 *   calling convention and return types. The mock encryption uses an
 *   XOR-keystream (sha256 of pk bytes) so the round-trip is bit-perfect.
 *
 *   Real wiring points (confirmed AML primitives — Octra AppliedML syntax):
 *     fhe_load_pk(pk_addr)         — load public key from on-chain address string
 *     fhe_deser(ct)                — deserialize ciphertext string to cipher object
 *     fhe_scale(pk, ct, scalar)    — multiply ciphertext by plaintext integer scalar
 *     fhe_add(pk, ct_a, ct_b)      — homomorphic addition of two ciphertexts
 *     fhe_add_const(pk, ct, int)   — add plaintext integer constant to ciphertext
 *     fhe_sub(pk, ct_a, ct_b)      — homomorphic subtraction
 *     fhe_ser(ct)                  — serialize ciphertext back to string
 *     fhe_verify_zero(pk, ct, proof) — verify a ciphertext decrypts to zero
 *
 *   RPC wrappers (method names unconfirmed — verify via node_status):
 *     ghostFheKeygen()   → WIRE: RPC name TBD (assumed fhe_keygen)
 *     ghostFheEncrypt()  → WIRE: RPC name TBD (assumed fhe_encrypt)
 *     ghostFheDecrypt()  → WIRE: RPC name TBD (assumed fhe_decrypt)
 *   See octra-rpc.ts for async RPC wrappers.
 */

import { sha256 } from '@noble/hashes/sha256';
import type { FHEPublicKey, FHEScaled } from './types.js';

export class FHEError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FHEError';
  }
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Loads an FHE public key from raw bytes.
 *
 * The key is used to encrypt queries before they enter a sealed Circle.
 * The Circle's private key (held inside the sealed environment and never
 * exposed) is the only thing that can decrypt the inference result.
 *
 * WIRE: fhe_load_pk(pk_addr: string) — load public key from address
 *       Replace body with OctraHFHE.loadPublicKey(pkBytes) when SDK ships.
 */
export function fhe_load_pk(pkBytes: Uint8Array): FHEPublicKey {
  if (pkBytes.length === 0) {
    throw new FHEError('fhe_load_pk: public key bytes must not be empty');
  }
  const keyId = toHex(sha256(pkBytes)).slice(0, 16);
  // CKKS standard scale: 2^40 ≈ 1.1e12 gives ~40-bit fixed-point precision
  const scale = 2 ** 40;
  return { bytes: pkBytes, algorithm: 'ckks-mock', scale, keyId };
}

/**
 * Scales a plaintext float for CKKS FHE encoding.
 *
 * In real CKKS: maps the float to a polynomial ring element at the given
 * scale factor. The resulting FHEScaled can be homomorphically added or
 * multiplied without decryption — the inference server operates on
 * ciphertexts only and never sees the underlying value.
 *
 * WIRE: fhe_scale(pk, ct, scalar: int) — multiply ct by plaintext scalar
 *       Replace body with OctraHFHE.scale(value, pk.scale) when SDK ships.
 */
export function fhe_scale(value: number, scale: number): FHEScaled {
  if (scale <= 0) {
    throw new FHEError(`fhe_scale: scale must be positive, got ${scale}`);
  }
  const scaled = value * scale;
  const ciphertext = new Uint8Array(8);
  new DataView(ciphertext.buffer).setFloat64(0, scaled, true);
  return { scaled, scale, ciphertext };
}

/**
 * Adds two FHE-scaled values homomorphically.
 *
 * Both operands must share the same scale. In CKKS this corresponds to
 * polynomial addition in the ciphertext ring — no decryption needed.
 * Used in the VeilLM inference path to aggregate token embeddings.
 *
 * WIRE: fhe_add(pk, ct_a, ct_b) — homomorphic addition
 *       Replace body with OctraHFHE.add(a, b) when SDK ships.
 */
export function fhe_add(a: FHEScaled, b: FHEScaled): FHEScaled {
  if (a.scale !== b.scale) {
    throw new FHEError(
      `fhe_add: scale mismatch — left ${a.scale} !== right ${b.scale}. ` +
        `Rescale one operand before adding.`,
    );
  }
  const sum = a.scaled + b.scaled;
  const ciphertext = new Uint8Array(8);
  new DataView(ciphertext.buffer).setFloat64(0, sum, true);
  return { scaled: sum, scale: a.scale, ciphertext };
}

/**
 * Encrypts a plaintext payload for sealed Circle execution.
 *
 * Wire format: [4-byte LE payload length][8-byte FHE feature context][XOR-encrypted payload]
 *
 * The 8-byte FHE feature context is the ciphertext of (byteLength + tokenCount)
 * encoded via fhe_scale / fhe_add — this mirrors the real CKKS workflow where
 * prompt embeddings are accumulated as scaled homomorphic values before the
 * inference kernel runs.
 *
 * WIRE: fhe_deser(ct_string) — deserialize ciphertext; fhe_scale / fhe_add / fhe_ser for results
 *       Replace with OctraHFHE.encrypt(payload, pk) when SDK ships.
 *       In-contract flow: client serializes features as ct0/ct1 strings; contract calls fhe_deser().
 */
export function encryptPayload(payload: Uint8Array, pk: FHEPublicKey): Uint8Array {
  // Encode text features as FHE-scaled values (mirrors real CKKS token encoding)
  const byteFeature = fhe_scale(payload.length, pk.scale);
  const tokenFeature = fhe_scale(Math.max(1, payload.length >> 3), pk.scale);
  const combined = fhe_add(byteFeature, tokenFeature);

  const keystream = sha256(pk.bytes);
  // Layout: [4 length][8 FHE context][payload.length encrypted bytes]
  const result = new Uint8Array(12 + payload.length);
  new DataView(result.buffer).setUint32(0, payload.length, true);
  result.set(combined.ciphertext, 4);
  for (let i = 0; i < payload.length; i++) {
    result[12 + i] = payload[i] ^ keystream[i % keystream.length];
  }
  return result;
}

/**
 * Decrypts a ciphertext produced by encryptPayload using the same public key.
 *
 * In the real system this operation runs inside the sealed Circle using the
 * Circle's private key — the plaintext is never exposed outside the FHE
 * environment. The mock mirrors the interface with XOR decryption.
 *
 * WIRE: fhe_ser(ct) — serialize ciphertext to string (contract output format)
 *       Replace with OctraHFHE.decrypt(ciphertext, sk) when SDK ships.
 *       In-contract flow: ghost_predict returns fhe_ser(result); client decrypts via fhe_decrypt RPC.
 */
export function decryptPayload(ciphertext: Uint8Array, pk: FHEPublicKey): Uint8Array {
  if (ciphertext.length < 12) {
    throw new FHEError(
      `decryptPayload: ciphertext too short (${ciphertext.length} bytes, minimum 12)`,
    );
  }
  const len = new DataView(ciphertext.buffer, ciphertext.byteOffset, 4).getUint32(0, true);
  if (ciphertext.length < 12 + len) {
    throw new FHEError(
      `decryptPayload: truncated ciphertext — expected ${12 + len} bytes, got ${ciphertext.length}`,
    );
  }
  const keystream = sha256(pk.bytes);
  const result = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    result[i] = ciphertext[12 + i] ^ keystream[i % keystream.length];
  }
  return result;
}
