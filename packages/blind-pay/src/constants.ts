/** RFC 9578 §8.2 Token Type for publicly verifiable (blind RSA) tokens. */
export const TOKEN_TYPE = 0x0002;

/** RFC 9578 §6.3: Token.nonce is a 32-byte client-generated random value. */
export const NONCE_LENGTH = 32;

/** SHA-256 digest length used for both challenge_digest and token_key_id. */
export const DIGEST_LENGTH = 32;

/** 2048-bit RSA modulus, as used by the RSABSSA-SHA384-PSS-Deterministic suite. */
export const RSA_MODULUS_LENGTH = 2048;

export const RSA_PUBLIC_EXPONENT = Uint8Array.from([1, 0, 1]);
