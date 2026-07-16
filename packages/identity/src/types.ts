/** ML-DSA-65 identity keypair, held as raw bytes. */
export type IdentityKeyPair = {
  readonly publicKey: Uint8Array;
  readonly secretKey: Uint8Array;
};

/** Base64-encoded form of an {@link IdentityKeyPair}, suitable for storage. */
export type SerializedIdentityKeyPair = {
  readonly publicKey: string;
  readonly secretKey: string;
};

/** A payload signed by an identity secret key, plus the resulting signature. */
export type CapabilityToken = {
  readonly payload: Uint8Array;
  readonly signature: Uint8Array;
};

/** Base64-encoded form of a {@link CapabilityToken}. */
export type SerializedCapabilityToken = {
  readonly payload: string;
  readonly signature: string;
};
