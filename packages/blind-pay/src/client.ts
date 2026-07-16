import { DIGEST_LENGTH, NONCE_LENGTH, TOKEN_TYPE } from './constants.js';
import { concatBytes, sha256, uint16BE } from './encoding.js';
import { computeTokenKeyId, suite } from './suite.js';
import type {
  BlindedTokenRequest,
  BlindSignature,
  ClientBlindingState,
  CryptoKey,
  PurchaseProof,
  Token,
  TokenChallenge,
} from './types.js';

/**
 * Builds and blinds a token request. `purchaseProof` authenticates this call
 * to the issuer as coming from a paying user (e.g. logged against the
 * payment out-of-band) — it is the linkable step in this flow. It is not
 * incorporated into the blinded message, so it cannot be recovered from, or
 * correlated with, the token produced later by {@link unblindToken}.
 */
export async function requestBlindToken(
  purchaseProof: PurchaseProof,
  issuerPublicKey: CryptoKey,
  challenge: TokenChallenge,
): Promise<{ request: BlindedTokenRequest; blindingState: ClientBlindingState }> {
  if (purchaseProof.length === 0) {
    throw new Error('purchaseProof must be a non-empty proof of payment');
  }

  const nonce = new Uint8Array(NONCE_LENGTH);
  crypto.getRandomValues(nonce);

  const challengeDigest = await sha256(challenge);
  const tokenKeyId = await computeTokenKeyId(issuerPublicKey);

  const tokenInput = concatBytes(uint16BE(TOKEN_TYPE), nonce, challengeDigest, tokenKeyId);
  const preparedMessage = suite.prepare(tokenInput);
  const { blindedMsg, inv } = await suite.blind(issuerPublicKey, preparedMessage);

  const truncatedTokenKeyId = tokenKeyId[DIGEST_LENGTH - 1] as number;

  return {
    request: { tokenType: TOKEN_TYPE, truncatedTokenKeyId, blindedMessage: blindedMsg },
    blindingState: { preparedMessage, inv, nonce, challengeDigest, tokenKeyId },
  };
}

/**
 * Unblinds an issuer's blind signature into a finished, redeemable
 * {@link Token}. Only `blindingState` (held solely by the client) and the
 * issuer's public key are needed — the resulting token carries nothing that
 * ties it back to the original {@link requestBlindToken} call.
 */
export async function unblindToken(
  blindSignature: BlindSignature,
  blindingState: ClientBlindingState,
  issuerPublicKey: CryptoKey,
): Promise<Token> {
  const authenticator = await suite.finalize(
    issuerPublicKey,
    blindingState.preparedMessage,
    blindSignature,
    blindingState.inv,
  );

  return {
    tokenType: TOKEN_TYPE,
    nonce: blindingState.nonce,
    challengeDigest: blindingState.challengeDigest,
    tokenKeyId: blindingState.tokenKeyId,
    authenticator,
  };
}
