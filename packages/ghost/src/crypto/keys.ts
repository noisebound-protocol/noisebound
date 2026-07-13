import { pqcTransport } from './PQCTransport.js';

/**
 * PQC peer key placeholders, pending live key distribution.
 *
 * WIRE: replace these with real lookups once key distribution exists —
 * COORDINATOR_PUBLIC_KEY from the coordinator's node-registry entry,
 * OCTRA_NODE_PUBKEY from Octra's node_status / ghostPollTx RPC response.
 *
 * When unset, the fallback is this process's own pqcTransport public key,
 * so seal()/unseal() round-trip correctly in local dev/tests where the
 * "node" and the "coordinator" are the same process. That round-trip stops
 * being meaningful — and a real distinct peer key is required — the moment
 * Ghost actually runs as separate node and coordinator processes.
 */
export const COORDINATOR_PUBLIC_KEY = process.env.VEIL_COORDINATOR_PUBKEY ?? pqcTransport.getPublicKey();
export const OCTRA_NODE_PUBKEY = process.env.OCTRA_NODE_PUBKEY ?? pqcTransport.getPublicKey();
export const NODE_PRIVATE_KEY = process.env.VEIL_NODE_PRIVATE_KEY ?? null;
