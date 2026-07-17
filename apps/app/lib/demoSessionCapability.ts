import type { SessionCapability } from '@noisebound/pqc-wallet';

/**
 * Placeholder session capability for the action-trigger demo flow, which
 * doesn't yet let a user pick one of their real issued session capabilities
 * (see components/session for that real issuance flow). Shared by both the
 * mock and real on-chain executor wiring so neither has to invent its own.
 */
export const DEMO_SESSION_CAPABILITY: SessionCapability = {
  payload: {
    id: 'demo-session',
    sessionAddress: '0x000000000000000000000000000000000000ad',
    sessionPublicKey: '0x00',
    scope: { maxSpendWei: '0' },
    issuedAt: 0,
    expiresAt: 0,
  },
  signature: new Uint8Array(),
};
