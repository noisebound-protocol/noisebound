import { RSA_MODULUS_LENGTH, RSA_PUBLIC_EXPONENT } from './constants.js';
import { suite } from './suite.js';
import type { BlindedTokenRequest, BlindSignature, CryptoKey, IssuerKeyPair } from './types.js';

/** Generates a fresh RSABSSA-SHA384-PSS-Deterministic issuer keypair. */
export async function generateIssuerKeyPair(): Promise<IssuerKeyPair> {
  return suite.generateKey({
    modulusLength: RSA_MODULUS_LENGTH,
    publicExponent: RSA_PUBLIC_EXPONENT,
  });
}

/**
 * Blindly signs a client's token request. The issuer never sees the
 * request's nonce or challenge binding, only the blinded message and the
 * cleartext type/key-id fields already present on {@link BlindedTokenRequest}.
 */
export async function issueBlindSignature(
  request: BlindedTokenRequest,
  issuerPrivateKey: CryptoKey,
): Promise<BlindSignature> {
  return suite.blindSign(issuerPrivateKey, request.blindedMessage);
}
