import type { SessionCapabilityPayload } from '@noisebound/pqc-wallet';
import type { EscalationDecision } from '@noisebound/sigma-core';

/** Wire/storage form of a {@link import('@noisebound/pqc-wallet').SessionCapability} — signature as base64 instead of raw bytes. */
export interface SerializedSessionCapability {
  readonly payload: SessionCapabilityPayload;
  readonly signature: string;
}

/** A session capability plus the app-level bookkeeping the underlying package doesn't track. */
export interface StoredSessionCapability extends SerializedSessionCapability {
  readonly label: string;
  readonly fundingTxHash: `0x${string}`;
  revoked: boolean;
}

export interface EscalationDataDisclosureItem {
  readonly label: string;
  readonly value: string;
}

export interface EscalationLogEntry {
  readonly id: string;
  readonly timestamp: number;
  readonly description: string;
  readonly decision: EscalationDecision;
  readonly outcome: 'confirmed' | 'declined' | 'blocked' | 'auto-allowed';
}
