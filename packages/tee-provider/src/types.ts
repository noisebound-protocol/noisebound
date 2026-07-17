/**
 * Core types for renting attested TEE-capable GPU capacity from a cloud
 * confidential-computing provider.
 *
 * The shape here is informed by two real-world providers of this kind of
 * capacity:
 *  - Phala Cloud: confidential VMs (CVMs) move through
 *    Preparing -> Starting -> Running, are addressed by an app id, and
 *    expose a per-deployment attestation document at
 *    `https://<app-id>.dstack.phala.network/.well-known/attestation`
 *    (see https://docs.phala.com/phala-cloud/confidential-ai/confidential-gpu/deploy-and-verify).
 *  - Spheron: GPU instances are provisioned through a REST API keyed by
 *    instance id, region, and GPU model; NVIDIA confidential-computing mode
 *    is enabled per-reservation and produces a GPU-specific attestation
 *    report separate from any VM-level attestation
 *    (see https://docs.spheron.ai/api-reference).
 *
 * Neither provider's real API is wired up yet — see `mock-provider.ts` for
 * the stand-in used until Noisebound has live credentials with one of them.
 */

import type { AttestationToken } from '@noisebound/attest';

/** Lifecycle state of a rented TEE GPU instance. */
export type TeeInstanceStatus = 'provisioning' | 'running' | 'stopped' | 'error';

/**
 * A TEE-capable GPU instance as reported by a provider, with its raw
 * (not-yet-verified) attestation token attached. Callers must run this
 * through {@link getVerifiedInstance} before trusting or routing to it.
 */
export interface TeeInstance {
  /** Provider-assigned instance id (Phala app id / Spheron instance id equivalent). */
  readonly id: string;
  /** Name of the provider this instance came from, e.g. "phala", "spheron", "mock". */
  readonly provider: string;
  readonly region: string;
  readonly gpuModel: string;
  readonly status: TeeInstanceStatus;
  /** Provider-facing endpoint requests would be routed to once the instance is verified. */
  readonly endpoint: string;
  /** Raw attestation token as returned by the provider — unverified until checked by @noisebound/attest. */
  readonly attestationToken: AttestationToken;
}

/**
 * Selection preferences for choosing among available instances. Kept
 * intentionally minimal for now — an empty object means "any available
 * instance". Fields can grow (load, price, driver version, ...) as real
 * provider integrations land.
 */
export interface InstanceSelectionCriteria {
  readonly region?: string;
  readonly gpuModel?: string;
}

export interface RouteRequestPayload {
  readonly body: unknown;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface RouteRequestResult {
  readonly statusCode: number;
  readonly body: unknown;
}

/**
 * Contract any real TEE GPU provider integration (Phala, Spheron, ...) must
 * implement. Every method here operates on raw, unverified provider state —
 * attestation verification is layered on top by {@link getVerifiedInstance},
 * not performed by implementations of this interface.
 */
export interface TeeProvider {
  readonly name: string;

  /** Lists currently available instances, each with its raw attestation token attached. */
  listAvailableInstances(): Promise<readonly TeeInstance[]>;

  /** Picks a suitable instance from a given pool of candidates, per `criteria`. */
  selectInstance(criteria: InstanceSelectionCriteria): Promise<TeeInstance | undefined>;

  /** Sends a request to a specific, already-selected instance. */
  routeRequest(instanceId: string, payload: RouteRequestPayload): Promise<RouteRequestResult>;
}
