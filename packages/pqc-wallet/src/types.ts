/** A random-per-session secp256k1 keypair used to sign and broadcast real on-chain transactions. */
export interface SessionKey {
  readonly address: `0x${string}`;
  readonly publicKey: string;
  readonly privateKey: `0x${string}`;
}

/** Spend and contract limits an identity key grants to a session key. */
export interface SessionCapabilityScope {
  readonly maxSpendWei: string;
  readonly allowedContracts?: readonly `0x${string}`[];
}

/** The data an identity key attests to when authorizing a session key. */
export interface SessionCapabilityPayload {
  readonly id: string;
  readonly sessionAddress: `0x${string}`;
  readonly sessionPublicKey: string;
  readonly scope: SessionCapabilityScope;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

/** An ML-DSA-65-signed grant binding a session key to a scope and expiry. */
export interface SessionCapability {
  readonly payload: SessionCapabilityPayload;
  readonly signature: Uint8Array;
}

/** Tracks revoked capability token ids. Real persistence is a future concern. */
export interface RevocationRegistry {
  revoke(tokenId: string): void;
  isRevoked(tokenId: string): boolean;
}

/** A wallet with native-token balance used to gas-fund newly issued session keys. */
export interface FunderWallet {
  readonly privateKey: `0x${string}`;
}

/** Result of composing capability issuance with an on-chain funding transfer. */
export interface IssueAndFundResult {
  readonly capability: SessionCapability;
  readonly fundingTxHash: `0x${string}`;
}
