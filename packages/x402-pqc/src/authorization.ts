import type { TypedDataDomain, TypedDataField } from 'ethers';
import type { NetworkConfig } from '@noisebound/networks';
import type { PaymentAuthorization } from './types.js';

/** EIP-3009 `TransferWithAuthorization` typed-data types, as implemented by USDC. */
export const TRANSFER_WITH_AUTHORIZATION_TYPES: Record<string, TypedDataField[]> = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
};

/** Builds the EIP-712 domain for USDC's `transferWithAuthorization` on the given network. */
export function usdcDomain(network: NetworkConfig): TypedDataDomain {
  return {
    name: 'USD Coin',
    version: '2',
    chainId: network.chainId,
    verifyingContract: network.usdcAddress,
  };
}

/** Generates a fresh random 32-byte nonce for an authorization, hex-encoded. */
export function generateNonce(): `0x${string}` {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `0x${hex}`;
}

/** Type-safe view of a `PaymentAuthorization` as an EIP-712 message record. */
export function authorizationMessage(authorization: PaymentAuthorization): Record<string, unknown> {
  return { ...authorization };
}
