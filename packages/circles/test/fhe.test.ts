import { describe, it, expect } from 'vitest';
import {
  fhe_load_pk,
  fhe_scale,
  fhe_add,
  encryptPayload,
  decryptPayload,
  FHEError,
} from '../src/fhe.js';

// ─── Test fixtures ────────────────────────────────────────────────────────────

function makePkBytes(seed = 42): Uint8Array {
  return Uint8Array.from({ length: 32 }, (_, i) => (seed + i) & 0xff);
}

// ─── fhe_load_pk ─────────────────────────────────────────────────────────────

describe('fhe_load_pk', () => {
  it('returns FHEPublicKey with algorithm="ckks-mock"', () => {
    const pk = fhe_load_pk(makePkBytes());
    expect(pk.algorithm).toBe('ckks-mock');
  });

  it('keyId is a 16-character hex string', () => {
    const pk = fhe_load_pk(makePkBytes());
    expect(pk.keyId).toHaveLength(16);
    expect(/^[0-9a-f]+$/.test(pk.keyId)).toBe(true);
  });

  it('scale is 2^40', () => {
    const pk = fhe_load_pk(makePkBytes());
    expect(pk.scale).toBe(2 ** 40);
  });

  it('bytes are stored unchanged', () => {
    const raw = makePkBytes(7);
    const pk = fhe_load_pk(raw);
    expect(pk.bytes).toEqual(raw);
  });

  it('throws FHEError for empty bytes', () => {
    expect(() => fhe_load_pk(new Uint8Array(0))).toThrow(FHEError);
  });

  it('FHEError from empty bytes has correct name', () => {
    try {
      fhe_load_pk(new Uint8Array(0));
    } catch (err) {
      expect((err as FHEError).name).toBe('FHEError');
    }
  });

  it('different pk bytes produce different keyIds', () => {
    const pk1 = fhe_load_pk(makePkBytes(1));
    const pk2 = fhe_load_pk(makePkBytes(2));
    expect(pk1.keyId).not.toBe(pk2.keyId);
  });

  it('same pk bytes always produce the same keyId (deterministic)', () => {
    const raw = makePkBytes(99);
    expect(fhe_load_pk(raw).keyId).toBe(fhe_load_pk(raw).keyId);
  });
});

// ─── fhe_scale ───────────────────────────────────────────────────────────────

describe('fhe_scale', () => {
  it('returns FHEScaled with correct scaled value', () => {
    const s = fhe_scale(3.0, 1000);
    expect(s.scaled).toBeCloseTo(3000, 5);
  });

  it('scale is stored in result', () => {
    const s = fhe_scale(1.5, 2 ** 20);
    expect(s.scale).toBe(2 ** 20);
  });

  it('ciphertext is a Uint8Array of length 8', () => {
    const s = fhe_scale(42, 100);
    expect(s.ciphertext).toBeInstanceOf(Uint8Array);
    expect(s.ciphertext.length).toBe(8);
  });

  it('throws FHEError for scale=0', () => {
    expect(() => fhe_scale(1.0, 0)).toThrow(FHEError);
  });

  it('throws FHEError for negative scale', () => {
    expect(() => fhe_scale(1.0, -1)).toThrow(FHEError);
  });

  it('zero value produces scaled=0', () => {
    const s = fhe_scale(0, 1000);
    expect(s.scaled).toBe(0);
  });

  it('negative value scales correctly', () => {
    const s = fhe_scale(-2.5, 1000);
    expect(s.scaled).toBeCloseTo(-2500, 5);
  });

  it('large scale (2^40) preserves integer precision for small values', () => {
    const scale = 2 ** 40;
    const s = fhe_scale(1, scale);
    expect(s.scaled).toBe(scale);
  });
});

// ─── fhe_add ─────────────────────────────────────────────────────────────────

describe('fhe_add', () => {
  it('sums two scaled values correctly', () => {
    const a = fhe_scale(2.0, 1000);
    const b = fhe_scale(3.0, 1000);
    const result = fhe_add(a, b);
    expect(result.scaled).toBeCloseTo(5000, 5);
  });

  it('throws FHEError for mismatched scales', () => {
    const a = fhe_scale(1.0, 1000);
    const b = fhe_scale(1.0, 2000);
    expect(() => fhe_add(a, b)).toThrow(FHEError);
  });

  it('FHEError for mismatched scales has correct name', () => {
    const a = fhe_scale(1.0, 1000);
    const b = fhe_scale(1.0, 500);
    try {
      fhe_add(a, b);
    } catch (err) {
      expect((err as FHEError).name).toBe('FHEError');
    }
  });

  it('result has same scale as inputs', () => {
    const scale = 2 ** 30;
    const a = fhe_scale(1.0, scale);
    const b = fhe_scale(2.0, scale);
    expect(fhe_add(a, b).scale).toBe(scale);
  });

  it('ciphertext is a Uint8Array of length 8', () => {
    const a = fhe_scale(1, 100);
    const b = fhe_scale(2, 100);
    expect(fhe_add(a, b).ciphertext).toBeInstanceOf(Uint8Array);
    expect(fhe_add(a, b).ciphertext.length).toBe(8);
  });

  it('add(a, zero-scaled) = a.scaled', () => {
    const a = fhe_scale(7.0, 1000);
    const zero = fhe_scale(0, 1000);
    expect(fhe_add(a, zero).scaled).toBeCloseTo(a.scaled, 5);
  });

  it('addition is commutative', () => {
    const a = fhe_scale(3.0, 1000);
    const b = fhe_scale(5.0, 1000);
    expect(fhe_add(a, b).scaled).toBeCloseTo(fhe_add(b, a).scaled, 5);
  });
});

// ─── encryptPayload / decryptPayload ─────────────────────────────────────────

describe('encryptPayload / decryptPayload', () => {
  it('encryptPayload produces a non-empty Uint8Array', () => {
    const pk = fhe_load_pk(makePkBytes());
    const result = encryptPayload(new TextEncoder().encode('hello'), pk);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBeGreaterThan(0);
  });

  it('output length equals payload.length + 12 (4 length + 8 FHE context)', () => {
    const pk = fhe_load_pk(makePkBytes());
    const payload = new TextEncoder().encode('test payload');
    expect(encryptPayload(payload, pk).length).toBe(payload.length + 12);
  });

  it('different plaintext inputs produce different ciphertexts', () => {
    const pk = fhe_load_pk(makePkBytes());
    const ct1 = encryptPayload(new TextEncoder().encode('hello'), pk);
    const ct2 = encryptPayload(new TextEncoder().encode('world'), pk);
    expect(ct1).not.toEqual(ct2);
  });

  it('decryptPayload round-trips back to the original payload', () => {
    const pk = fhe_load_pk(makePkBytes());
    const original = new TextEncoder().encode('swap 1 ETH for USDC on uniswap');
    const ciphertext = encryptPayload(original, pk);
    const recovered = decryptPayload(ciphertext, pk);
    expect(recovered).toEqual(original);
  });

  it('decryptPayload throws FHEError for ciphertext shorter than 12 bytes', () => {
    const pk = fhe_load_pk(makePkBytes());
    expect(() => decryptPayload(new Uint8Array(5), pk)).toThrow(FHEError);
  });

  it('different pk produces different ciphertext for the same input', () => {
    const pk1 = fhe_load_pk(makePkBytes(1));
    const pk2 = fhe_load_pk(makePkBytes(2));
    const payload = new TextEncoder().encode('hello');
    expect(encryptPayload(payload, pk1)).not.toEqual(encryptPayload(payload, pk2));
  });

  it('the same pk always decrypts its own ciphertext (idempotent key)', () => {
    const pk = fhe_load_pk(makePkBytes(77));
    const payload = new TextEncoder().encode('bridge 0.5 ETH to arbitrum via hop');
    const ct = encryptPayload(payload, pk);
    expect(decryptPayload(ct, pk)).toEqual(payload);
  });

  it('decryptPayload throws FHEError for empty ciphertext', () => {
    const pk = fhe_load_pk(makePkBytes());
    expect(() => decryptPayload(new Uint8Array(0), pk)).toThrow(FHEError);
  });

  it('encryptPayload + decryptPayload round-trips JSON', () => {
    const pk = fhe_load_pk(makePkBytes());
    const obj = { prompt: 'stake 2 ETH on lido', context: { availableProtocols: ['lido'] } };
    const payload = new TextEncoder().encode(JSON.stringify(obj));
    const recovered = decryptPayload(encryptPayload(payload, pk), pk);
    expect(JSON.parse(new TextDecoder().decode(recovered))).toEqual(obj);
  });
});

// ─── FHEError ─────────────────────────────────────────────────────────────────

describe('FHEError', () => {
  it('has name="FHEError"', () => {
    const err = new FHEError('test');
    expect(err.name).toBe('FHEError');
  });

  it('is an instance of Error', () => {
    expect(new FHEError('oops')).toBeInstanceOf(Error);
  });
});
