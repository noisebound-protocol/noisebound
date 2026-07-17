/**
 * Orchestration: turn a provider's raw, unverified instance pool into a
 * single instance that is safe to route real requests to.
 *
 * Fail-closed by construction — an instance only ever enters the eligible
 * pool by passing {@link shouldReleaseKey}'s attestation gate. If every
 * instance in a provider's pool fails attestation (including a pool of
 * exactly one), the result is `no_verified_instance`; there is no fallback
 * path to an unverified instance.
 */

import {
  shouldReleaseKey,
  verifyAttestationToken,
  type MeasurementAllowlist,
  type VerifyAttestationTokenOptions,
} from '@noisebound/attest';
import type { InstanceSelectionCriteria, RouteRequestPayload, RouteRequestResult, TeeInstance, TeeProvider } from './types.js';
import { selectFromPool } from './select-instance.js';

/** Why a single instance was excluded from the verified pool. */
export interface RejectedInstance {
  readonly instanceId: string;
  readonly reasons: readonly string[];
}

/**
 * A pool of instances that have already passed attestation, plus the one
 * selected from among them. `routeVerifiedRequest` is the only supported
 * way to send a request against a session — it re-checks that the target
 * instance id is actually a member of `verifiedInstanceIds` before routing.
 */
export interface VerifiedTeeSession {
  readonly provider: TeeProvider;
  readonly instance: TeeInstance;
  readonly verifiedInstanceIds: ReadonlySet<string>;
}

export type GetVerifiedInstanceResult =
  | { readonly status: 'selected'; readonly session: VerifiedTeeSession }
  | { readonly status: 'no_verified_instance'; readonly rejected: readonly RejectedInstance[] };

export interface GetVerifiedInstanceOptions {
  readonly criteria?: InstanceSelectionCriteria;
  /**
   * Passed through to `verifyAttestationToken` for every candidate
   * instance. In this simplified flow every instance in a single listing
   * round is checked against the same issued challenge nonce; a real
   * per-device challenge-response flow would issue a distinct nonce per
   * instance before listing.
   */
  readonly verification: VerifyAttestationTokenOptions;
}

/**
 * Lists available instances from `provider`, verifies every single one's
 * attestation against `expectedMeasurements`, and selects among only the
 * instances that passed. An instance that fails attestation is never
 * eligible for selection, even if it is the only instance available.
 */
export async function getVerifiedInstance(
  provider: TeeProvider,
  expectedMeasurements: MeasurementAllowlist,
  options: GetVerifiedInstanceOptions,
): Promise<GetVerifiedInstanceResult> {
  const candidates = await provider.listAvailableInstances();

  const verifiedInstances: TeeInstance[] = [];
  const rejected: RejectedInstance[] = [];

  for (const instance of candidates) {
    const verification = verifyAttestationToken(instance.attestationToken, expectedMeasurements, options.verification);
    if (shouldReleaseKey(verification)) {
      verifiedInstances.push(instance);
    } else {
      rejected.push({ instanceId: instance.id, reasons: verification.reasons });
    }
  }

  if (verifiedInstances.length === 0) {
    return { status: 'no_verified_instance', rejected };
  }

  const selected = selectFromPool(verifiedInstances, options.criteria ?? {});
  if (!selected) {
    return { status: 'no_verified_instance', rejected };
  }

  return {
    status: 'selected',
    session: {
      provider,
      instance: selected,
      verifiedInstanceIds: new Set(verifiedInstances.map((instance) => instance.id)),
    },
  };
}

/** Raised when a caller attempts to route a request to an instance id that never passed attestation as part of `session`. */
export class UnverifiedInstanceError extends Error {
  constructor(instanceId: string) {
    super(`refusing to route request to unverified instance "${instanceId}"`);
    this.name = 'UnverifiedInstanceError';
  }
}

/**
 * The only supported way to send a request against a {@link VerifiedTeeSession}.
 * Rejects with {@link UnverifiedInstanceError} if `instanceId` is not one of
 * the instances that passed attestation in this session — including
 * instances that existed in the provider's pool but were filtered out.
 */
export async function routeVerifiedRequest(
  session: VerifiedTeeSession,
  instanceId: string,
  payload: RouteRequestPayload,
): Promise<RouteRequestResult> {
  if (!session.verifiedInstanceIds.has(instanceId)) {
    throw new UnverifiedInstanceError(instanceId);
  }
  return session.provider.routeRequest(instanceId, payload);
}
