import { concatBytes, toHex, uint16BE } from './encoding.js';
import { suite } from './suite.js';
import type { CryptoKey, RedemptionOutcome, RedemptionRegistry, Token } from './types.js';

/** Creates an in-memory, Set-backed double-spend registry keyed by token nonce. */
export function createRedemptionRegistry(): RedemptionRegistry {
  const redeemed = new Set<string>();
  return {
    has(token: Token): boolean {
      return redeemed.has(toHex(token.nonce));
    },
    markRedeemed(token: Token): void {
      redeemed.add(toHex(token.nonce));
    },
  };
}

/**
 * Redeems a token: verifies the issuer's signature and enforces
 * single-use via `registry`. Takes only the final unblinded {@link Token} —
 * there is no linkage data structure connecting a redemption back to the
 * {@link requestBlindToken} call that produced it.
 */
export async function redeemToken(
  token: Token,
  issuerPublicKey: CryptoKey,
  registry: RedemptionRegistry,
): Promise<RedemptionOutcome> {
  if (registry.has(token)) {
    return { valid: false, reason: 'already-redeemed' };
  }

  const tokenInput = concatBytes(
    uint16BE(token.tokenType),
    token.nonce,
    token.challengeDigest,
    token.tokenKeyId,
  );
  const preparedMessage = suite.prepare(tokenInput);
  const isValid = await suite.verify(issuerPublicKey, token.authenticator, preparedMessage);

  if (!isValid) {
    return { valid: false, reason: 'invalid-signature' };
  }

  registry.markRedeemed(token);
  return { valid: true };
}
