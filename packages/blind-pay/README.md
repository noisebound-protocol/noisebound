# @noisebound/blind-pay

RFC 9578 Privacy Pass blind-token issuance and redemption for Noisebound's cloud inference tier.

This package implements the client, issuer, and redemption sides of a Privacy Pass token flow using RSA blind signatures (Token Type `0x0002`, the RSABSSA-SHA384-PSS-Deterministic suite from `@cloudflare/blindrsa-ts`). A client with a `PurchaseProof` (e.g. a payment receipt id) requests a blinded token from an issuer; the issuer signs the blinded message without seeing its contents; the client unblinds the signature into a finished `Token`. The purchase proof is the only step in the flow linkable to the user's identity — it is never incorporated into the blinded message, so the resulting token, and its later redemption, cannot be correlated back to the purchase or to the specific issuance call that produced it. Redemption verifies the issuer's signature over the token and enforces single-use via a pluggable `RedemptionRegistry`.

## API

### Types

- `PurchaseProof` — `string` alias for an opaque proof of payment (e.g. a payment processor's receipt id); authenticates a token request to the issuer but never appears in the token or redemption path.
- `TokenChallenge` — `Uint8Array` context bytes identifying what the token may be redeemed for (RFC 9578 TokenChallenge).
- `IssuerKeyPair` — Web Crypto `CryptoKeyPair` for the RSABSSA-SHA384-PSS-Deterministic suite.
- `BlindedTokenRequest` — `{ tokenType, truncatedTokenKeyId, blindedMessage }`, the client-to-issuer message (RFC 9578 §6.4 TokenRequest).
- `ClientBlindingState` — `{ preparedMessage, inv, nonce, challengeDigest, tokenKeyId }`, the client-held secret needed to unblind a signature; never sent to the issuer or presented at redemption.
- `BlindSignature` — `Uint8Array`, the issuer's blind signature over a `BlindedTokenRequest`, before unblinding.
- `Token` — `{ tokenType, nonce, challengeDigest, tokenKeyId, authenticator }`, a finished, redeemable token (RFC 9578 §6.3) carrying no data linking it back to its `BlindedTokenRequest`.
- `RedemptionOutcome` — `{ valid: true } | { valid: false, reason: 'invalid-signature' | 'already-redeemed' }`.
- `RedemptionRegistry` — `{ has(token): boolean; markRedeemed(token): void }`, a double-spend registry keyed by token nonce.

### Constants

- `TOKEN_TYPE` — `0x0002`, the RFC 9578 §8.2 Token Type for publicly verifiable (blind RSA) tokens.
- `NONCE_LENGTH` — `32`, byte length of `Token.nonce` (RFC 9578 §6.3).
- `RSA_MODULUS_LENGTH` — `2048`, the RSA modulus size used by the issuer keypair.

### Functions

- `generateIssuerKeyPair(): Promise<IssuerKeyPair>` — generates a fresh RSABSSA-SHA384-PSS-Deterministic issuer keypair.
- `issueBlindSignature(request: BlindedTokenRequest, issuerPrivateKey: CryptoKey): Promise<BlindSignature>` — blindly signs a client's token request; the issuer sees only the blinded message and cleartext type/key-id fields.
- `requestBlindToken(purchaseProof: PurchaseProof, issuerPublicKey: CryptoKey, challenge: TokenChallenge): Promise<{ request: BlindedTokenRequest; blindingState: ClientBlindingState }>` — builds and blinds a token request; throws if `purchaseProof` is empty.
- `unblindToken(blindSignature: BlindSignature, blindingState: ClientBlindingState, issuerPublicKey: CryptoKey): Promise<Token>` — unblinds an issuer's blind signature into a finished, redeemable `Token`.
- `createRedemptionRegistry(): RedemptionRegistry` — creates an in-memory, `Set`-backed double-spend registry keyed by token nonce.
- `redeemToken(token: Token, issuerPublicKey: CryptoKey, registry: RedemptionRegistry): Promise<RedemptionOutcome>` — verifies the token's signature and enforces single-use redemption against `registry`.

## Usage

```ts
import {
  createRedemptionRegistry,
  generateIssuerKeyPair,
  issueBlindSignature,
  redeemToken,
  requestBlindToken,
  unblindToken,
} from '@noisebound/blind-pay';

const { publicKey, privateKey } = await generateIssuerKeyPair();
const challenge = new TextEncoder().encode('noisebound-cloud-inference');

// Client: build a blinded request against a purchase receipt.
const { request, blindingState } = await requestBlindToken('receipt_abc123', publicKey, challenge);

// Issuer: sign the blinded message without seeing its contents.
const blindSignature = await issueBlindSignature(request, privateKey);

// Client: unblind into a finished, redeemable token.
const token = await unblindToken(blindSignature, blindingState, publicKey);

// Redemption: verify the signature and enforce single-use.
const registry = createRedemptionRegistry();
const outcome = await redeemToken(token, publicKey, registry); // { valid: true }
```

`blindingState` and `request` are held only by the client and are never passed to `redeemToken`, so redemption has no data available to correlate a token back to the purchase proof or issuance call that produced it.
