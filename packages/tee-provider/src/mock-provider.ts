/**
 * MockTeeProvider — in-memory stand-in for a real TEE GPU rental provider.
 *
 * NON-PRODUCTION. This exists only because Noisebound does not yet have
 * live credentials/API access with a real confidential-computing GPU
 * provider. It is a stand-in for a future real integration such as:
 *  - Phala Cloud (https://docs.phala.com) — confidential VMs provisioned
 *    via a REST API, moving through Preparing -> Starting -> Running, with
 *    attestation retrievable per-deployment.
 *  - Spheron (https://docs.spheron.ai) — GPU instances provisioned via a
 *    REST API, with NVIDIA confidential-computing mode enabled per
 *    reservation and a GPU-specific attestation report.
 *
 * Swap this out for a real `TeeProvider` implementation once one of those
 * integrations exists. Nothing in `getVerifiedInstance` depends on this
 * module.
 */

import {
  buildMockClaims,
  buildMockEnclaveIdentity,
  createMockSignatureVerifier,
  signMockToken,
  type AttestationTokenClaims,
  type Clock,
  type SignatureVerifier,
} from '@noisebound/attest';
import type {
  InstanceSelectionCriteria,
  RouteRequestPayload,
  RouteRequestResult,
  TeeInstance,
  TeeInstanceStatus,
  TeeProvider,
} from './types.js';
import { selectFromPool } from './select-instance.js';

/**
 * Test-only signing key for mock attestation tokens. A real provider
 * integration verifies against the provider's actual attestation service
 * (NRAS JWKS, etc.) instead of a shared secret — see the REAL INTEGRATION
 * POINT notes in `@noisebound/attest`'s `verify.ts`/`testing.ts`.
 */
export const MOCK_TEE_SIGNING_KEY = 'mock-tee-provider-signing-key';

/** Verifier matching tokens signed with {@link MOCK_TEE_SIGNING_KEY}, for use in tests/dev only. */
export function createMockTeeSignatureVerifier(): SignatureVerifier {
  return createMockSignatureVerifier(MOCK_TEE_SIGNING_KEY);
}

export interface BuildMockTeeInstanceOptions {
  readonly id: string;
  readonly region?: string;
  readonly gpuModel?: string;
  readonly status?: TeeInstanceStatus;
  readonly clock: Clock;
  /** Nonce the mock instance's attestation token will echo back. Pass a mismatched value to simulate a replay/wrong-challenge failure. */
  readonly nonce: string;
  /** Overrides applied on top of an otherwise-genuine set of mock claims, to simulate specific failure modes (expired, bad measurement, debug mode, ...). */
  readonly claimsOverrides?: Partial<AttestationTokenClaims>;
  /** Sign with a different key to simulate a token that fails signature verification. Defaults to {@link MOCK_TEE_SIGNING_KEY}. */
  readonly signingKey?: string;
}

/**
 * Builds one mock TEE instance with a plausible, signed (but not
 * necessarily *valid*) attestation token attached. Combine several of these
 * — some built to pass verification, some deliberately built to fail it —
 * to seed a {@link MockTeeProvider} pool for tests.
 */
export function buildMockTeeInstance(options: BuildMockTeeInstanceOptions): TeeInstance {
  const {
    id,
    region = 'us-east-1',
    gpuModel = 'H100-SXM5',
    status = 'running',
    clock,
    nonce,
    claimsOverrides = {},
    signingKey = MOCK_TEE_SIGNING_KEY,
  } = options;

  const claims = buildMockClaims(clock, {
    subject: id,
    nonce,
    identity: buildMockEnclaveIdentity({ ueid: `mock-ueid-${id}` }),
    ...claimsOverrides,
  });

  return {
    id,
    provider: 'mock',
    region,
    gpuModel,
    status,
    endpoint: `https://mock-tee-provider.invalid/instances/${id}`,
    attestationToken: signMockToken(claims, signingKey),
  };
}

/**
 * In-memory {@link TeeProvider} implementation for tests and local
 * development. Holds a fixed pool of instances handed to it at
 * construction time (typically built with {@link buildMockTeeInstance}) and
 * serves `listAvailableInstances`/`selectInstance`/`routeRequest` from that
 * pool. Performs no attestation verification itself — that is
 * `getVerifiedInstance`'s job.
 */
export class MockTeeProvider implements TeeProvider {
  readonly name = 'mock';

  private readonly instances: ReadonlyMap<string, TeeInstance>;

  constructor(instances: readonly TeeInstance[]) {
    this.instances = new Map(instances.map((instance) => [instance.id, instance]));
  }

  listAvailableInstances(): Promise<readonly TeeInstance[]> {
    const available = Array.from(this.instances.values()).filter((instance) => instance.status === 'running');
    return Promise.resolve(available);
  }

  async selectInstance(criteria: InstanceSelectionCriteria): Promise<TeeInstance | undefined> {
    return selectFromPool(await this.listAvailableInstances(), criteria);
  }

  routeRequest(instanceId: string, payload: RouteRequestPayload): Promise<RouteRequestResult> {
    const instance = this.instances.get(instanceId);
    if (!instance) {
      return Promise.reject(new Error(`mock provider has no instance with id "${instanceId}"`));
    }
    return Promise.resolve({
      statusCode: 200,
      body: { instanceId: instance.id, echo: payload.body },
    });
  }
}
