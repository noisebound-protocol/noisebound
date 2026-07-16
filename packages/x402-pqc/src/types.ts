import type { NetworkName } from '@noisebound/networks';
import type { SessionCapability } from '@noisebound/pqc-wallet';

/** The x402 scheme this package implements: an exact, single-transfer payment amount. */
export type PaymentScheme = 'exact';

/** The wire version of the payment payload, per the x402 spec. */
export const X402_VERSION = 1;

/**
 * A payment challenge, i.e. the terms a server would express in a 402 Payment Required
 * response's `accepts` list (x402's `PaymentRequirements`).
 */
export interface PaymentChallenge {
  readonly scheme: PaymentScheme;
  readonly network: NetworkName;
  /** Amount required, in the asset's smallest atomic unit (e.g. USDC has 6 decimals), as a decimal string. */
  readonly maxAmountRequired: string;
  /** The resource being paid for, e.g. a URL. */
  readonly resource: string;
  readonly description?: string;
  /** Address the payment must be made to. */
  readonly payTo: `0x${string}`;
  /** ERC-20 asset contract address (must match the active network's registered asset). */
  readonly asset: `0x${string}`;
  /** How long, from issuance, the resulting authorization remains valid. */
  readonly maxTimeoutSeconds: number;
}

/** An EIP-3009 `transferWithAuthorization` message authorizing a single USDC transfer. */
export interface PaymentAuthorization {
  readonly from: `0x${string}`;
  readonly to: `0x${string}`;
  readonly value: string;
  readonly validAfter: string;
  readonly validBefore: string;
  readonly nonce: `0x${string}`;
}

/**
 * A signed x402 payment payload (the `X-PAYMENT` header contents), extended with the
 * Noisebound session capability that authorized it in place of a direct wallet signature.
 */
export interface PaymentPayload {
  readonly x402Version: typeof X402_VERSION;
  readonly scheme: PaymentScheme;
  readonly network: NetworkName;
  readonly asset: `0x${string}`;
  readonly payload: {
    /** secp256k1 signature over `authorization`, produced by the session key. */
    readonly signature: string;
    readonly authorization: PaymentAuthorization;
  };
  /** The ML-DSA-65-signed session capability that authorized the session key to sign this payment. */
  readonly capability: SessionCapability;
}
