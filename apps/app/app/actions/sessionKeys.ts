'use server';

import 'server-only';
import { deserializeIdentityKeyPair } from '@noisebound/identity';
import type { SerializedIdentityKeyPair } from '@noisebound/identity';
import type { SessionCapabilityScope } from '@noisebound/pqc-wallet';
import { base64ToBytes, bytesToBase64 } from '../../lib/base64';
import { getRevocationRegistry } from '../../lib/registry';
import { issueNewSessionCapability, revokeStoredCapability } from '../../lib/sessionKeyActions';
import type { SerializedSessionCapability } from '../../lib/types';

export interface IssueSessionKeyResult {
  readonly capability: SerializedSessionCapability;
  readonly fundingTxHash: `0x${string}`;
}

/** Issues a new session capability for the caller's identity and gas-funds it on-chain. */
export async function issueSessionKeyAction(
  identity: SerializedIdentityKeyPair,
  scope: SessionCapabilityScope,
  ttlMs: number,
): Promise<IssueSessionKeyResult> {
  const identityKeyPair = deserializeIdentityKeyPair(identity);
  const result = await issueNewSessionCapability(identityKeyPair, scope, ttlMs);

  return {
    capability: {
      payload: result.capability.payload,
      signature: bytesToBase64(result.capability.signature),
    },
    fundingTxHash: result.fundingTxHash,
  };
}

/** Revokes a session capability against the dev-fixture revocation registry. */
export async function revokeSessionKeyAction(
  capability: SerializedSessionCapability,
): Promise<void> {
  const registry = getRevocationRegistry();
  revokeStoredCapability(registry, {
    payload: capability.payload,
    signature: base64ToBytes(capability.signature),
  });
}
