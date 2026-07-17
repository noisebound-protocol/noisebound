# @noisebound/x402-pqc

x402 HTTP payment protocol adapted to Noisebound's PQC session-capability model.

This package implements the `exact` x402 scheme (a single EIP-3009 `transferWithAuthorization` USDC transfer) but replaces the direct wallet signature x402 normally expects with a Noisebound session key authorized by an ML-DSA-65-signed `SessionCapability` (from `@noisebound/pqc-wallet`). `createPaymentPayload` builds and signs a payment payload from a session capability and key, checking the capability's spend limit, expiry, and revocation status before signing anything. `verifyPaymentPayload` checks a received payload end-to-end: the capability's own signature/expiry/revocation, that the session key named in the capability produced the transfer signature, and that the transfer amount and asset are within the capability's authorized scope.

## Exports

### Functions

- `createPaymentPayload(capability: SessionCapability, sessionKey: SessionKey, challenge: PaymentChallenge, options?: CreatePaymentPayloadOptions): Promise<PaymentPayload>` — Builds and signs a `PaymentPayload` for a given `PaymentChallenge`, using the session key authorized by `capability`. Throws if the session key doesn't match the capability, the capability is expired or revoked (when a `RevocationRegistry` is passed via `options.registry`), the amount exceeds the capability's `maxSpendWei`, the asset isn't allowed by the capability's scope, or the challenge's network/asset don't match the currently active network.
- `verifyPaymentPayload(payload: PaymentPayload, identityPublicKey: Uint8Array, registry?: RevocationRegistry): boolean` — Verifies a `PaymentPayload`: validates the embedded session capability (signature, expiry, revocation), confirms the transfer was signed by the capability's session key, checks the amount/asset against the capability's scope and the authorization's validity window, and recovers the EIP-712 signer to confirm it matches the `from` address.
- `generateNonce(): \`0x${string}\`` — Generates a fresh random 32-byte hex-encoded nonce for an authorization.
- `usdcDomain(network: NetworkConfig): TypedDataDomain` — Builds the EIP-712 domain for USDC's `transferWithAuthorization` on the given network.
- `authorizationMessage(authorization: PaymentAuthorization): Record<string, unknown>` — Type-safe view of a `PaymentAuthorization` as an EIP-712 message record, for typed-data hashing/signing.

### Constants

- `X402_VERSION` — The wire version (`1`) of the payment payload, per the x402 spec.
- `TRANSFER_WITH_AUTHORIZATION_TYPES` — The EIP-3009 `TransferWithAuthorization` typed-data type definition, as implemented by USDC.

### Types

- `PaymentScheme` — The x402 scheme this package implements: `'exact'`.
- `PaymentChallenge` — The terms a server expresses in a 402 response's `accepts` list: scheme, network, `maxAmountRequired`, `resource`, `payTo`, `asset`, and `maxTimeoutSeconds`.
- `PaymentAuthorization` — An EIP-3009 `transferWithAuthorization` message (`from`, `to`, `value`, `validAfter`, `validBefore`, `nonce`).
- `PaymentPayload` — The signed x402 payment payload (`X-PAYMENT` header contents): version, scheme, network, asset, the signed `authorization`/`signature`, and the `capability` that authorized it.
- `CreatePaymentPayloadOptions` — Options for `createPaymentPayload`; currently just an optional `registry: RevocationRegistry` to check for revocation.

## Usage

```ts
import { generateIdentityKeyPair } from '@noisebound/identity';
import { generateSessionKey, issueSessionCapability } from '@noisebound/pqc-wallet';
import { createPaymentPayload, verifyPaymentPayload } from '@noisebound/x402-pqc';
import type { PaymentChallenge } from '@noisebound/x402-pqc';

const identityKeyPair = generateIdentityKeyPair();
const sessionKey = generateSessionKey();
const capability = issueSessionCapability(
  identityKeyPair,
  sessionKey.publicKey,
  { maxSpendWei: '2000000' },
  60_000, // capability lifetime, ms
);

const challenge: PaymentChallenge = {
  scheme: 'exact',
  network: 'base-sepolia',
  maxAmountRequired: '1000000',
  resource: 'https://api.example.com/widgets',
  payTo: '0x...',
  asset: '0x...', // must match the active network's USDC address
  maxTimeoutSeconds: 60,
};

const payload = await createPaymentPayload(capability, sessionKey, challenge);

const isValid = verifyPaymentPayload(payload, identityKeyPair.publicKey);
```

Note: `createPaymentPayload` and `verifyPaymentPayload` resolve the active network via `@noisebound/networks`' `getActiveNetwork()` and require `challenge.network`/`payload.network` to match it.
