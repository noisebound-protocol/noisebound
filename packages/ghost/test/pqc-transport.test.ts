import { describe, it, expect } from 'vitest';
import { PQCTransport, pqcTransport, getAuditLog, type PQCEnvelope } from '../src/crypto/PQCTransport.js';

describe('PQCTransport', () => {
  it('seal() produces a valid PQCEnvelope shape', async () => {
    const sender = new PQCTransport();
    const recipient = new PQCTransport();
    await sender.init();
    await recipient.init();

    const envelope = await sender.seal({ hello: 'world' }, recipient.getPublicKey());

    expect(envelope.version).toBe('1.0');
    expect(typeof envelope.kemCiphertext).toBe('string');
    expect(envelope.kemCiphertext.length).toBeGreaterThan(0);
    expect(typeof envelope.encryptedPayload).toBe('string');
    expect(envelope.encryptedPayload.length).toBeGreaterThan(0);
    expect(envelope.senderPublicKey).toBe(sender.getPublicKey());
    expect(typeof envelope.signature).toBe('string');
    expect(envelope.signature.length).toBeGreaterThan(0);
    expect(typeof envelope.timestamp).toBe('number');
  });

  it('unseal() correctly decrypts a sealed payload', async () => {
    const sender = new PQCTransport();
    const recipient = new PQCTransport();
    await sender.init();
    await recipient.init();

    const payload = { amount: '100', recipient: '0xabc', nested: { ok: true } };
    const envelope = await sender.seal(payload, recipient.getPublicKey());
    const result = await recipient.unseal(envelope);

    expect(result).toEqual(payload);
  });

  it('seal() never leaks the plaintext payload in the envelope', async () => {
    const sender = new PQCTransport();
    const recipient = new PQCTransport();
    await sender.init();
    await recipient.init();

    const envelope = await sender.seal({ secret: 'do-not-leak-this-token' }, recipient.getPublicKey());
    const serialized = JSON.stringify(envelope);
    expect(serialized).not.toContain('do-not-leak-this-token');
  });

  it('verify() returns true for an untampered envelope', async () => {
    const sender = new PQCTransport();
    const recipient = new PQCTransport();
    await sender.init();
    await recipient.init();

    const envelope = await sender.seal({ x: 1 }, recipient.getPublicKey());
    const valid = await sender.verify(envelope, envelope.senderPublicKey);
    expect(valid).toBe(true);
  });

  it('verify() returns false for a tampered envelope', async () => {
    const sender = new PQCTransport();
    const recipient = new PQCTransport();
    await sender.init();
    await recipient.init();

    const envelope = await sender.seal({ x: 1 }, recipient.getPublicKey());
    const tampered: PQCEnvelope = { ...envelope, encryptedPayload: envelope.encryptedPayload + 'tampered' };
    const valid = await sender.verify(tampered, tampered.senderPublicKey);
    expect(valid).toBe(false);
  });

  it('unseal() rejects a tampered envelope', async () => {
    const sender = new PQCTransport();
    const recipient = new PQCTransport();
    await sender.init();
    await recipient.init();

    const envelope = await sender.seal({ x: 1 }, recipient.getPublicKey());
    const tampered: PQCEnvelope = { ...envelope, encryptedPayload: envelope.encryptedPayload + 'tampered' };
    await expect(recipient.unseal(tampered)).rejects.toThrow();
  });

  it('unseal() rejects a replayed envelope older than 5 minutes', async () => {
    const sender = new PQCTransport();
    const recipient = new PQCTransport();
    await sender.init();
    await recipient.init();

    const envelope = await sender.seal({ x: 1 }, recipient.getPublicKey());
    const stale: PQCEnvelope = { ...envelope, timestamp: Date.now() - 6 * 60 * 1000 };

    // re-sign so the staleness check (not the signature check) is what fails
    const resigned = await sender.seal({ x: 1 }, recipient.getPublicKey());
    const staleResigned: PQCEnvelope = { ...resigned, timestamp: stale.timestamp };
    await expect(recipient.unseal(staleResigned)).rejects.toThrow(/expired|replay/i);
  });

  it('getPublicKey() returns a stable, decodable identity', async () => {
    const transport = new PQCTransport();
    await transport.init();
    const key1 = transport.getPublicKey();
    const key2 = transport.getPublicKey();
    expect(key1).toBe(key2);
  });

  it('exportPrivateKey()/init(existing) round-trips the same identity', async () => {
    const transport = new PQCTransport();
    await transport.init();
    const publicKey = transport.getPublicKey();
    const exported = transport.exportPrivateKey();

    const restored = new PQCTransport();
    await restored.init(exported);
    expect(restored.getPublicKey()).toBe(publicKey);
  });

  it('records an audit entry for every seal/unseal/verify operation', async () => {
    const sender = new PQCTransport();
    const recipient = new PQCTransport();
    await sender.init();
    await recipient.init();

    const before = getAuditLog().length;
    const envelope = await sender.seal({ x: 1 }, recipient.getPublicKey());
    await recipient.unseal(envelope); // unseal() also calls verify() internally
    await sender.verify(envelope, envelope.senderPublicKey);
    const after = getAuditLog();
    const recordedSinceTest = after.slice(before);

    expect(recordedSinceTest.length).toBeGreaterThanOrEqual(4);
    const operations = recordedSinceTest.map(e => e.operation);
    expect(operations).toContain('seal');
    expect(operations).toContain('unseal');
    expect(operations).toContain('verify');
    for (const entry of recordedSinceTest) {
      expect(entry.kemAlgorithm).toBe('ML-KEM-768');
      expect(entry.sigAlgorithm).toBe('ML-DSA-65');
    }
  });

  it('records a broadcast audit entry via recordBroadcast', () => {
    const before = getAuditLog().length;
    pqcTransport.recordBroadcast('weights', true);
    const after = getAuditLog();
    expect(after.length).toBe(before + 1);
    expect(after[after.length - 1].operation).toBe('broadcast');
  });

  it('never stores plaintext in the in-memory audit log', async () => {
    const sender = new PQCTransport();
    const recipient = new PQCTransport();
    await sender.init();
    await recipient.init();

    await sender.seal({ secret: 'super-secret-value' }, recipient.getPublicKey());
    const serialized = JSON.stringify(getAuditLog());
    expect(serialized).not.toContain('super-secret-value');
  });
});
