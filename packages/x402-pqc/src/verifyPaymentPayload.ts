import { recoverAddress, TypedDataEncoder } from 'ethers';
import { CHAIN_REGISTRY } from '@noisebound/networks';
import { verifySessionCapability } from '@noisebound/pqc-wallet';
import type { RevocationRegistry } from '@noisebound/pqc-wallet';
import { authorizationMessage, TRANSFER_WITH_AUTHORIZATION_TYPES, usdcDomain } from './authorization.js';
import type { PaymentPayload } from './types.js';

/**
 * Verifies an x402 payment payload: the signature over the transfer authorization, that it
 * was signed by the session key named in the capability, that the capability itself is a
 * validly-signed, non-expired, non-revoked grant from the identity key, and that the amount
 * being transferred is within the capability's spend limit.
 */
export function verifyPaymentPayload(
  payload: PaymentPayload,
  identityPublicKey: Uint8Array,
  registry?: RevocationRegistry,
): boolean {
  if (!verifySessionCapability(identityPublicKey, payload.capability, registry)) {
    return false;
  }

  const { authorization, signature } = payload.payload;
  const scope = payload.capability.payload.scope;

  if (authorization.from !== payload.capability.payload.sessionAddress) {
    return false;
  }

  if (BigInt(authorization.value) > BigInt(scope.maxSpendWei)) {
    return false;
  }

  if (scope.allowedContracts !== undefined && !scope.allowedContracts.includes(payload.asset)) {
    return false;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (nowSeconds >= Number(authorization.validBefore) || nowSeconds < Number(authorization.validAfter)) {
    return false;
  }

  const networkConfig = CHAIN_REGISTRY[payload.network];
  if (payload.asset !== networkConfig.usdcAddress) {
    return false;
  }

  try {
    const digest = TypedDataEncoder.hash(
      usdcDomain(networkConfig),
      TRANSFER_WITH_AUTHORIZATION_TYPES,
      authorizationMessage(authorization),
    );
    const recovered = recoverAddress(digest, signature);
    return recovered.toLowerCase() === authorization.from.toLowerCase();
  } catch {
    return false;
  }
}
