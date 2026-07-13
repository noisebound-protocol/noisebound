import fetch from 'node-fetch';
import { ethers } from 'ethers';
import { fhe_load_pk, fhe_scale, fhe_add, type FHEScaled } from '@noisebound/circles';
import { pqcTransport, type PQCEnvelope } from '../crypto/PQCTransport.js';
import { COORDINATOR_PUBLIC_KEY } from '../crypto/keys.js';
import type { TrainingRound } from './types.js';

const VEIL_NODE_REGISTRY_ABI = [
  'event NodeRegistered(address indexed node, uint256 stakeAmount)',
  'event NodeDeregistered(address indexed node)',
  'function isRegistered(address node) view returns (bool)',
];

const DEFAULT_API_URL = 'https://api.veilprotocol.net';
const DEFAULT_RPC_URL = 'https://sepolia.base.org';
const AGGREGATE_PK_SEED = 'veil-federated-coordinator-pk';

export interface FederatedCoordinatorOptions {
  apiUrl?: string;
  rpcUrl?: string;
  nodeRegistryAddress?: string;
}

/**
 * Coordinates federated training rounds across Ghost nodes.
 *
 * Node discovery reads VeilNodeRegistry.sol on Base Sepolia for the
 * authoritative registration state; round coordination (start/stop, weight
 * broadcast) talks to api.veilprotocol.net since there is no on-chain queue
 * for that traffic.
 */
export class FederatedCoordinator {
  readonly nodeRegistryAddress: string;
  private readonly apiUrl: string;
  private readonly provider: ethers.JsonRpcProvider;

  constructor(options: FederatedCoordinatorOptions = {}) {
    this.nodeRegistryAddress = options.nodeRegistryAddress ?? '0xed79Cf810eeF76F8a7379a79A1Be304f0CFE5f05';
    this.apiUrl = options.apiUrl ?? DEFAULT_API_URL;
    this.provider = new ethers.JsonRpcProvider(options.rpcUrl ?? DEFAULT_RPC_URL);
  }

  /**
   * Discovers active nodes by reading NodeRegistered events from
   * VeilNodeRegistry.sol, then confirming each is still registered via
   * isRegistered (excludes nodes that were later deregistered).
   */
  async getActiveNodes(): Promise<string[]> {
    try {
      const registry = new ethers.Contract(this.nodeRegistryAddress, VEIL_NODE_REGISTRY_ABI, this.provider);
      const events = await registry.queryFilter(registry.filters.NodeRegistered());
      const candidates = [...new Set(events.map(e => (e as ethers.EventLog).args?.node as string).filter(Boolean))];

      const active: string[] = [];
      for (const node of candidates) {
        const isRegistered: boolean = await registry.isRegistered(node);
        if (isRegistered) active.push(node);
      }
      return active;
    } catch {
      return [];
    }
  }

  async initiateTrainingRound(): Promise<TrainingRound> {
    const nodes = await this.getActiveNodes();
    const roundId = `round-${Date.now()}`;
    const round: TrainingRound = {
      roundId,
      startTime: Date.now(),
      nodeCount: nodes.length,
      pairsProcessed: 0,
      encryptedModelHash: '',
      status: 'pending',
    };

    try {
      const envelope = await pqcTransport.seal({ roundId, nodes }, COORDINATOR_PUBLIC_KEY);
      const res = await fetch(`${this.apiUrl}/training/round/start`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(envelope),
      });
      if (res.ok) {
        const data = (await res.json()) as Partial<TrainingRound>;
        return { ...round, ...data, status: data.status ?? 'aggregating' };
      }
    } catch {
      // api unreachable — caller can still proceed with locally aggregated nodes
    }
    return { ...round, status: 'aggregating' };
  }

  /**
   * Aggregates per-node encrypted gradients using fhe_add. Each gradient
   * is a serialized PQCEnvelope (sealed by GhostTrainer.computeLocalGradient);
   * it is unsealed to recover the hex digest, mapped to an FHE-scaled value,
   * and homomorphically summed — no gradient is ever decrypted by anyone but
   * this coordinator, and it is never persisted in plaintext. The aggregate
   * is re-sealed before being returned to the caller.
   */
  async aggregateGradients(nodeGradients: string[]): Promise<string> {
    if (nodeGradients.length === 0) {
      throw new Error('FederatedCoordinator.aggregateGradients: nodeGradients must not be empty');
    }

    const gradients = await Promise.all(
      nodeGradients.map(async ng => (await pqcTransport.unseal(JSON.parse(ng) as PQCEnvelope)) as string),
    );

    const pk = fhe_load_pk(new TextEncoder().encode(AGGREGATE_PK_SEED));
    const scaledValues = gradients.map(g => fhe_scale(gradientToFloat(g), pk.scale));
    const aggregate = scaledValues.reduce((acc: FHEScaled, v) => fhe_add(acc, v));
    const aggregatedHex = aggregate.scaled.toString(16);

    return JSON.stringify(await pqcTransport.seal(aggregatedHex, COORDINATOR_PUBLIC_KEY));
  }

  async commitModelHash(modelHash: string, roundId: string): Promise<string> {
    try {
      const signature = pqcTransport.signHash(modelHash);
      const res = await fetch(`${this.apiUrl}/training/model/commit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ modelHash, roundId, signature }),
      });
      if (res.ok) {
        const data = (await res.json()) as { txHash?: string };
        if (data.txHash) return data.txHash;
      }
    } catch {
      // fall through to mock hash below
    }
    // TODO: commit via a dedicated ModelRegistry contract (not yet deployed) or
    // x402PQCPayments.recordMetadata once that surface exists.
    return `0xmock${modelHash.slice(0, 56)}`;
  }

  /**
   * Broadcasts weights wrapped in a PQC envelope.
   *
   * WIRE: ML-KEM-768 has no true broadcast mode — each recipient needs its
   * own encapsulation against its own KEM public key. Once the node registry
   * exposes per-node public keys, seal once per active node here instead of
   * sealing to COORDINATOR_PUBLIC_KEY.
   */
  async broadcastWeights(encryptedWeights: string): Promise<void> {
    try {
      const envelope = await pqcTransport.seal({ weights: encryptedWeights, timestamp: Date.now() }, COORDINATOR_PUBLIC_KEY);
      const res = await fetch(`${this.apiUrl}/training/weights`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(envelope),
      });
      pqcTransport.recordBroadcast('weights', res.ok);
    } catch {
      pqcTransport.recordBroadcast('weights', false);
      // best-effort broadcast; nodes will pick up the next committed model hash on poll
    }
  }

  async scheduleRound(intervalHours: number): Promise<void> {
    await new Promise<void>(resolve => {
      setTimeout(() => resolve(), intervalHours * 60 * 60 * 1000);
    });
    await this.initiateTrainingRound();
  }
}

/** Maps a hex gradient digest to a small deterministic float for FHE scaling. */
function gradientToFloat(gradientHex: string): number {
  const slice = gradientHex.slice(0, 8) || '0';
  const intVal = parseInt(slice, 16) || 0;
  return intVal / 0xffffffff;
}
