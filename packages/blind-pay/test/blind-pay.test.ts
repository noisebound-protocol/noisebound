import { describe, expect, it } from 'vitest';
import {
  createRedemptionRegistry,
  generateIssuerKeyPair,
  issueBlindSignature,
  redeemToken,
  requestBlindToken,
  unblindToken,
} from '../src/index.js';
import type { Token } from '../src/index.js';

const challenge = (label: string): Uint8Array => new TextEncoder().encode(label);

async function issueToken(purchaseProof = 'receipt_abc123', challengeLabel = 'noisebound-cloud-inference') {
  const { publicKey, privateKey } = await generateIssuerKeyPair();
  const { request, blindingState } = await requestBlindToken(purchaseProof, publicKey, challenge(challengeLabel));
  const blindSignature = await issueBlindSignature(request, privateKey);
  const token = await unblindToken(blindSignature, blindingState, publicKey);
  return { token, publicKey, privateKey };
}

describe('issuance -> unblind -> redeem round trip', () => {
  it('succeeds for a freshly issued token', async () => {
    const { token, publicKey } = await issueToken();
    const registry = createRedemptionRegistry();

    const outcome = await redeemToken(token, publicKey, registry);

    expect(outcome).toEqual({ valid: true });
  });

  it('rejects requesting a token with an empty purchase proof', async () => {
    const { publicKey } = await generateIssuerKeyPair();

    await expect(requestBlindToken('', publicKey, challenge('noisebound-cloud-inference'))).rejects.toThrow();
  });
});

describe('double-spend protection', () => {
  it('fails redemption the second time the same token is redeemed', async () => {
    const { token, publicKey } = await issueToken();
    const registry = createRedemptionRegistry();

    const first = await redeemToken(token, publicKey, registry);
    const second = await redeemToken(token, publicKey, registry);

    expect(first).toEqual({ valid: true });
    expect(second).toEqual({ valid: false, reason: 'already-redeemed' });
  });
});

describe('tamper resistance', () => {
  it('fails redemption when the authenticator has been tampered with', async () => {
    const { token, publicKey } = await issueToken();
    const registry = createRedemptionRegistry();

    const tamperedAuthenticator = new Uint8Array(token.authenticator);
    tamperedAuthenticator[0] = (tamperedAuthenticator[0] as number) ^ 0xff;
    const tampered: Token = { ...token, authenticator: tamperedAuthenticator };

    const outcome = await redeemToken(tampered, publicKey, registry);

    expect(outcome).toEqual({ valid: false, reason: 'invalid-signature' });
  });

  it('fails redemption when the nonce has been tampered with', async () => {
    const { token, publicKey } = await issueToken();
    const registry = createRedemptionRegistry();

    const tamperedNonce = new Uint8Array(token.nonce);
    tamperedNonce[0] = (tamperedNonce[0] as number) ^ 0xff;
    const tampered: Token = { ...token, nonce: tamperedNonce };

    const outcome = await redeemToken(tampered, publicKey, registry);

    expect(outcome).toEqual({ valid: false, reason: 'invalid-signature' });
  });

  it('fails redemption against a different issuer key', async () => {
    const { token } = await issueToken();
    const otherIssuer = await generateIssuerKeyPair();
    const registry = createRedemptionRegistry();

    const outcome = await redeemToken(token, otherIssuer.publicKey, registry);

    expect(outcome).toEqual({ valid: false, reason: 'invalid-signature' });
  });
});

describe('unlinkability', () => {
  it('redeemToken takes only the final token, with no data structure linking it back to issuance', async () => {
    // redeemToken's signature is (token, issuerPublicKey, registry) — it has
    // no parameter for the blinded request, the blinding secret, or the
    // purchase proof from requestBlindToken. There is nothing to pass here
    // even if we wanted the issuer to correlate this redemption with the
    // purchase: that data is never produced by unblindToken and never
    // reaches this call.
    expect(redeemToken.length).toBe(3);

    const { token, publicKey } = await issueToken();
    const registry = createRedemptionRegistry();
    const tokenKeys = Object.keys(token).sort();

    expect(tokenKeys).toEqual(['authenticator', 'challengeDigest', 'nonce', 'tokenKeyId', 'tokenType'].sort());

    const outcome = await redeemToken(token, publicKey, registry);
    expect(outcome).toEqual({ valid: true });
  });

  it('two tokens issued under the same purchase proof are unlinkable at redemption', async () => {
    const { publicKey, privateKey } = await generateIssuerKeyPair();
    const purchaseProof = 'receipt_same_purchase';
    const c = challenge('noisebound-cloud-inference');

    const first = await requestBlindToken(purchaseProof, publicKey, c);
    const second = await requestBlindToken(purchaseProof, publicKey, c);

    const firstToken = await unblindToken(await issueBlindSignature(first.request, privateKey), first.blindingState, publicKey);
    const secondToken = await unblindToken(await issueBlindSignature(second.request, privateKey), second.blindingState, publicKey);

    expect(firstToken.nonce).not.toEqual(secondToken.nonce);
    expect(firstToken.authenticator).not.toEqual(secondToken.authenticator);

    const registry = createRedemptionRegistry();
    expect(await redeemToken(firstToken, publicKey, registry)).toEqual({ valid: true });
    expect(await redeemToken(secondToken, publicKey, registry)).toEqual({ valid: true });
  });
});
