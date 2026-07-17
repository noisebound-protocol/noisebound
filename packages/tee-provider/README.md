# @noisebound/tee-provider

Backend-side abstraction for renting attested TEE-capable GPU capacity from confidential-compute providers.

This package defines a provider-agnostic `TeeProvider` contract for listing, selecting, and routing requests to TEE (trusted execution environment) GPU instances, plus an orchestration layer (`getVerifiedInstance`) that lists a provider's instance pool, verifies each candidate's attestation token via `@noisebound/attest`, and only ever selects from among the instances that passed. The flow is fail-closed by construction: an instance that fails attestation is never eligible for selection, even if it's the only one available, and `routeVerifiedRequest` re-checks that a target instance id actually passed verification before sending a request to it.

No real provider integration is wired up yet. The `TeeProvider` shape is informed by two real-world providers (Phala Cloud and Spheron — see `src/types.ts` for details), but the only implementation in this package is `MockTeeProvider`, an in-memory, non-production stand-in for tests and local development.

## Exports

### Types (`types.ts`)

- `TeeInstanceStatus` — lifecycle state of a rented instance: `'provisioning' | 'running' | 'stopped' | 'error'`.
- `TeeInstance` — a provider-reported instance (id, provider name, region, GPU model, status, endpoint) with its raw, not-yet-verified `attestationToken`.
- `InstanceSelectionCriteria` — optional `{ region?, gpuModel? }` filter; an empty object means "any available instance".
- `RouteRequestPayload` — `{ body, headers? }` sent to an instance.
- `RouteRequestResult` — `{ statusCode, body }` returned from an instance.
- `TeeProvider` — the interface a real provider integration must implement: `listAvailableInstances()`, `selectInstance(criteria)`, `routeRequest(instanceId, payload)`. Operates only on raw, unverified state; attestation is layered on top by `getVerifiedInstance`.

### Selection (`select-instance.ts`)

- `selectFromPool(instances, criteria): TeeInstance | undefined` — pure filter that returns the first instance in `instances` matching `criteria.region`/`criteria.gpuModel`. Used both by provider implementations and by `getVerifiedInstance`'s post-attestation selection.

### Verified orchestration (`get-verified-instance.ts`)

- `getVerifiedInstance(provider, expectedMeasurements, options): Promise<GetVerifiedInstanceResult>` — lists `provider`'s available instances, verifies each one's attestation token against `expectedMeasurements` (via `@noisebound/attest`), and selects among only the instances that passed, per `options.criteria`. Returns `{ status: 'selected', session }` or `{ status: 'no_verified_instance', rejected }`.
- `routeVerifiedRequest(session, instanceId, payload): Promise<RouteRequestResult>` — the only supported way to send a request against a `VerifiedTeeSession`. Throws `UnverifiedInstanceError` if `instanceId` is not among the instances that passed attestation in that session.
- `UnverifiedInstanceError` — error class thrown by `routeVerifiedRequest` for an unverified/unknown instance id.
- `RejectedInstance` — `{ instanceId, reasons }` describing why a candidate instance was excluded from the verified pool.
- `VerifiedTeeSession` — `{ provider, instance, verifiedInstanceIds }`: the selected instance plus the set of instance ids that passed attestation in this round.
- `GetVerifiedInstanceResult` — discriminated union returned by `getVerifiedInstance` (`'selected'` with a session, or `'no_verified_instance'` with the rejection list).
- `GetVerifiedInstanceOptions` — `{ criteria?, verification }`, where `verification` is passed through to `@noisebound/attest`'s `verifyAttestationToken` for every candidate.

### Mock provider (`mock-provider.ts`) — non-production, for tests/dev only

- `MockTeeProvider` — in-memory `TeeProvider` implementation backed by a fixed pool of instances supplied at construction. Performs no attestation verification itself (that's `getVerifiedInstance`'s job); `routeRequest` just echoes the payload back with a 200.
- `buildMockTeeInstance(options): TeeInstance` — builds one mock instance with a plausible, signed attestation token. `claimsOverrides` and `signingKey` let a test simulate specific failure modes (expired, bad measurement, wrong signing key, debug mode, etc.).
- `BuildMockTeeInstanceOptions` — options for `buildMockTeeInstance`: `id`, `region?`, `gpuModel?`, `status?`, `clock`, `nonce`, `claimsOverrides?`, `signingKey?`.
- `createMockTeeSignatureVerifier(): SignatureVerifier` — a `@noisebound/attest` signature verifier matching tokens signed with `MOCK_TEE_SIGNING_KEY`.
- `MOCK_TEE_SIGNING_KEY` — the shared test-only signing key used by default when building/verifying mock tokens.

## Usage

```ts
import { getVerifiedInstance, routeVerifiedRequest } from '@noisebound/tee-provider';
import { MockTeeProvider, buildMockTeeInstance, createMockTeeSignatureVerifier } from '@noisebound/tee-provider';
import { DEFAULT_MOCK_MEASUREMENT } from '@noisebound/attest';

const nonce = 'challenge-nonce';
const instance = buildMockTeeInstance({ id: 'gpu-1', clock, nonce });
const provider = new MockTeeProvider([instance]);

const result = await getVerifiedInstance(
  provider,
  [{ name: DEFAULT_MOCK_MEASUREMENT.name, algorithm: DEFAULT_MOCK_MEASUREMENT.algorithm, allowedValues: [DEFAULT_MOCK_MEASUREMENT.value] }],
  { verification: { expectedNonce: nonce, maxAgeMs: 60_000, clock, signatureVerifier: createMockTeeSignatureVerifier() } },
);

if (result.status === 'selected') {
  const response = await routeVerifiedRequest(result.session, instance.id, { body: { prompt: 'hello' } });
}
```

## Development

- `pnpm build` — compile with `tsc`.
- `pnpm typecheck` — type-check without emitting.
- `pnpm test` — run the vitest suite.
