# @noisebound/cloud-request

Gate that authorizes a private cloud inference request before any payload leaves the client. It combines two independent checks from sibling packages — TEE attestation verification (`@noisebound/attest`) and blind-pay token redemption (`@noisebound/blind-pay`) — into a single ordered call, and returns a discriminated-union outcome the caller must handle explicitly.

The order is deliberate: attestation is checked first via `verifyAttestationToken` and `shouldReleaseKey`, and the blind-pay token is only redeemed (`redeemToken`) if attestation passes. If attestation fails, the function returns immediately without touching the redemption registry, so a payment token is never spent against an enclave that hasn't been verified. This package does not itself send the request payload anywhere or perform any cryptography beyond what `@noisebound/attest` and `@noisebound/blind-pay` provide — it only sequences those two checks and reports the result.

## API

### `authorizeCloudRequest(attestationToken, expectedMeasurements, verifyOptions, blindPayToken, issuerPublicKey, redemptionRegistry): Promise<CloudRequestOutcome>`

Runs the two-gate check: verifies `attestationToken` against `expectedMeasurements`/`verifyOptions`, then (only if that passes) redeems `blindPayToken` against `issuerPublicKey` using `redemptionRegistry`. Resolves to a `CloudRequestOutcome` describing which gate(s) passed.

### Types

- `CloudRequestOutcome` — discriminated union on `status`: `AttestationFailedOutcome | PaymentFailedOutcome | AuthorizedOutcome`.
- `AttestationFailedOutcome` — `{ status: 'attestation-failed', attestation }`. Attestation verification failed; no blind-pay token was redeemed.
- `PaymentFailedOutcome` — `{ status: 'payment-failed', attestation, redemption }`. Attestation passed but the blind-pay token could not be redeemed (e.g. already spent); `redemption` is narrowed to the `valid: false` case of `RedemptionOutcome`.
- `AuthorizedOutcome` — `{ status: 'authorized', attestation, token }`. Both gates passed; carries the attestation result and the redeemed token for use in the subsequent cloud inference call.

## Usage

```ts
import { authorizeCloudRequest } from '@noisebound/cloud-request';

const outcome = await authorizeCloudRequest(
  attestationToken,
  expectedMeasurements,
  verifyOptions,
  blindPayToken,
  issuerPublicKey,
  redemptionRegistry,
);

switch (outcome.status) {
  case 'authorized':
    // outcome.token is the redeemed blind-pay token; safe to send the request payload.
    break;
  case 'attestation-failed':
    // outcome.attestation explains why the enclave was rejected; no token was spent.
    break;
  case 'payment-failed':
    // outcome.redemption explains why the token could not be redeemed (e.g. already-redeemed).
    break;
}
```
