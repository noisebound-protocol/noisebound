import { describe, expect, it } from 'vitest';
import {
  deserializeIdentityKeyPair,
  generateIdentityKeyPair,
  serializeIdentityKeyPair,
  signCapabilityToken,
  verifyCapabilityToken,
} from '../src/index.js';

const textPayload = (text: string): Uint8Array => new TextEncoder().encode(text);

describe('generateIdentityKeyPair', () => {
  it('produces a public and secret key with the expected ML-DSA-65 lengths', () => {
    const keyPair = generateIdentityKeyPair();

    expect(keyPair.publicKey).toBeInstanceOf(Uint8Array);
    expect(keyPair.secretKey).toBeInstanceOf(Uint8Array);
    expect(keyPair.publicKey.length).toBe(1952);
    expect(keyPair.secretKey.length).toBe(4032);
  });

  it('produces distinct keys on each call', () => {
    const first = generateIdentityKeyPair();
    const second = generateIdentityKeyPair();

    expect(first.secretKey).not.toEqual(second.secretKey);
    expect(first.publicKey).not.toEqual(second.publicKey);
  });
});

describe('signCapabilityToken / verifyCapabilityToken', () => {
  it('round-trips: a token signed with a secret key verifies with its matching public key', () => {
    const keyPair = generateIdentityKeyPair();
    const payload = textPayload('capability:grant:session-42');

    const token = signCapabilityToken(keyPair.secretKey, payload);
    const isValid = verifyCapabilityToken(keyPair.publicKey, token.payload, token.signature);

    expect(isValid).toBe(true);
  });

  it('fails verification when the payload has been tampered with', () => {
    const keyPair = generateIdentityKeyPair();
    const payload = textPayload('capability:grant:session-42');
    const token = signCapabilityToken(keyPair.secretKey, payload);

    const tamperedPayload = textPayload('capability:grant:session-99');
    const isValid = verifyCapabilityToken(keyPair.publicKey, tamperedPayload, token.signature);

    expect(isValid).toBe(false);
  });

  it('fails verification when checked against the wrong public key', () => {
    const signer = generateIdentityKeyPair();
    const impostor = generateIdentityKeyPair();
    const payload = textPayload('capability:grant:session-42');

    const token = signCapabilityToken(signer.secretKey, payload);
    const isValid = verifyCapabilityToken(impostor.publicKey, token.payload, token.signature);

    expect(isValid).toBe(false);
  });
});

describe('key serialization', () => {
  it('round-trips through base64 while preserving key validity for sign/verify', () => {
    const keyPair = generateIdentityKeyPair();
    const serialized = serializeIdentityKeyPair(keyPair);

    expect(typeof serialized.publicKey).toBe('string');
    expect(typeof serialized.secretKey).toBe('string');

    const restored = deserializeIdentityKeyPair(serialized);
    expect(restored.publicKey).toEqual(keyPair.publicKey);
    expect(restored.secretKey).toEqual(keyPair.secretKey);

    const payload = textPayload('round-trip-check');
    const token = signCapabilityToken(restored.secretKey, payload);
    expect(verifyCapabilityToken(restored.publicKey, token.payload, token.signature)).toBe(true);
  });
});
