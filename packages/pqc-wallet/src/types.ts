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

/**
 * A random-per-capability ECDSA P-256 keypair used to prove possession when
 * σ-1 exercises a scoped web-action capability (e.g. signing an outbound
 * HTTP request). Unlike {@link SessionKey}, this has no on-chain address —
 * it authenticates web calls, not transactions.
 */
export interface WebActionKey {
  readonly publicKey: string;
  readonly privateKey: string;
}

/** HTTP methods a web-action capability may authorize. */
export type WebActionMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * The origins/methods/call-budget an identity key grants to a web-action
 * subject key. Mirrors {@link SessionCapabilityScope}'s role for on-chain
 * session keys, but scoped to web calls instead of spend/contracts.
 */
export interface WebActionScope {
  readonly allowedOrigins: readonly string[];
  readonly allowedMethods: readonly WebActionMethod[];
  readonly maxCalls?: number;
}

/** The data an identity key attests to when authorizing a web-action subject key. */
export interface WebActionCapabilityPayload {
  readonly id: string;
  readonly subjectPublicKey: string;
  readonly scope: WebActionScope;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

/** An ML-DSA-65-signed grant binding a web-action subject key to a scope and expiry. */
export interface WebActionCapability {
  readonly payload: WebActionCapabilityPayload;
  readonly signature: Uint8Array;
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
