import { SigningKey, TypedDataEncoder } from 'ethers';
import { CHAIN_REGISTRY, getActiveNetwork } from '@noisebound/networks';
import type { RevocationRegistry, SessionCapability, SessionKey } from '@noisebound/pqc-wallet';
import { authorizationMessage, generateNonce, TRANSFER_WITH_AUTHORIZATION_TYPES, usdcDomain } from './authorization.js';
import { X402_VERSION } from './types.js';
import type { PaymentAuthorization, PaymentChallenge, PaymentPayload } from './types.js';

export interface CreatePaymentPayloadOptions {
  readonly registry?: RevocationRegistry;
}

/**
 * Constructs a signed x402 payment payload authorized by an active Noisebound session
 * capability, rejecting the request outright if the capability cannot legally cover it
 * rather than producing a payload the recipient would just reject anyway.
 */
export async function createPaymentPayload(
  capability: SessionCapability,
  sessionKey: SessionKey,
  challenge: PaymentChallenge,
  options: CreatePaymentPayloadOptions = {},
): Promise<PaymentPayload> {
  if (capability.payload.sessionAddress !== sessionKey.address) {
    throw new Error('session capability does not match the given session key');
  }

  if (Date.now() > capability.payload.expiresAt) {
    throw new Error('session capability has expired');
  }

  if (options.registry !== undefined && options.registry.isRevoked(capability.payload.id)) {
    throw new Error('session capability has been revoked');
  }

  const scope = capability.payload.scope;
  if (BigInt(challenge.maxAmountRequired) > BigInt(scope.maxSpendWei)) {
    throw new Error(
      `payment amount ${challenge.maxAmountRequired} exceeds session capability spend limit ${scope.maxSpendWei}`,
    );
  }

  if (scope.allowedContracts !== undefined && !scope.allowedContracts.includes(challenge.asset)) {
    throw new Error(`session capability does not authorize spending on asset ${challenge.asset}`);
  }

  const networkConfig = CHAIN_REGISTRY[challenge.network];
  const activeNetwork = getActiveNetwork();
  if (networkConfig.chainId !== activeNetwork.chainId) {
    throw new Error(`payment challenge network "${challenge.network}" is not the active network`);
  }
  if (challenge.asset !== activeNetwork.usdcAddress) {
    throw new Error(`payment challenge asset ${challenge.asset} does not match the active network's USDC address`);
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const authorization: PaymentAuthorization = {
    from: sessionKey.address,
    to: challenge.payTo,
    value: challenge.maxAmountRequired,
    validAfter: '0',
    validBefore: String(nowSeconds + challenge.maxTimeoutSeconds),
    nonce: generateNonce(),
  };

  const digest = TypedDataEncoder.hash(
    usdcDomain(activeNetwork),
    TRANSFER_WITH_AUTHORIZATION_TYPES,
    authorizationMessage(authorization),
  );
  const signingKey = new SigningKey(sessionKey.privateKey);
  const signature = signingKey.sign(digest).serialized;

  return {
    x402Version: X402_VERSION,
    scheme: challenge.scheme,
    network: challenge.network,
    asset: challenge.asset,
    payload: { signature, authorization },
    capability,
  };
}
