import type { webcrypto } from 'node:crypto';

/** A Web Crypto RSA-PSS key, as used by the RSABSSA-SHA384-PSS-Deterministic suite. */
export type CryptoKey = webcrypto.CryptoKey;

/**
 * An opaque reference to a completed payment (e.g. a payment processor's
 * receipt id). It authenticates a token request to the issuer and is the
 * one point in this flow that is linkable to the user's identity/purchase.
 * It never becomes part of the blinded token content, and is not present
 * anywhere in {@link Token} or the redemption path.
 */
export type PurchaseProof = string;

/** Context bytes identifying what the token may be redeemed for (RFC 9578's TokenChallenge). */
export type TokenChallenge = Uint8Array;

/** An RSA keypair for the RSABSSA-SHA384-PSS-Deterministic blind signature suite. */
export type IssuerKeyPair = webcrypto.CryptoKeyPair;

/**
 * The client->issuer message (RFC 9578 §6.4 TokenRequest). `blindedMessage`
 * hides the token's nonce and challenge binding from the issuer; only the
 * token type and a truncated key id accompany it in the clear.
 */
export type BlindedTokenRequest = {
  readonly tokenType: number;
  readonly truncatedTokenKeyId: number;
  readonly blindedMessage: Uint8Array;
};

/**
 * Client-held secret produced alongside a {@link BlindedTokenRequest}. Never
 * sent to the issuer and never presented at redemption time; it is what
 * `unblindToken` needs to turn a blind signature into a finished {@link Token}.
 */
export type ClientBlindingState = {
  readonly preparedMessage: Uint8Array;
  readonly inv: Uint8Array;
  readonly nonce: Uint8Array;
  readonly challengeDigest: Uint8Array;
  readonly tokenKeyId: Uint8Array;
};

/** The issuer's blind signature over a {@link BlindedTokenRequest}, before unblinding. */
export type BlindSignature = Uint8Array;

/**
 * A finished, redeemable token (RFC 9578 §6.3). Carries no data that
 * connects it back to the {@link BlindedTokenRequest} it was issued from.
 */
export type Token = {
  readonly tokenType: number;
  readonly nonce: Uint8Array;
  readonly challengeDigest: Uint8Array;
  readonly tokenKeyId: Uint8Array;
  readonly authenticator: Uint8Array;
};

export type RedemptionOutcome =
  | { readonly valid: true }
  | { readonly valid: false; readonly reason: 'invalid-signature' | 'already-redeemed' };

/** In-memory double-spend registry, keyed by token nonce. */
export type RedemptionRegistry = {
  has(token: Token): boolean;
  markRedeemed(token: Token): void;
};
