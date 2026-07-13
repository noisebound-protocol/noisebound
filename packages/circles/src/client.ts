/**
 * OctraClient — HTTP client for the Octra testnet RPC.
 *
 * Documented Octra REST API (source: octra-labs/octra_pre_client):
 *   GET  /balance/{address}  → { nonce, balance }  (balance in OCT)
 *   GET  /staging            → { staged_transactions: [...] }
 *   GET  /address/{address}  → { recent_transactions, has_public_key }
 *   GET  /tx/{hash}          → { parsed_tx: { from, to, amount, ... } }
 *   POST /send-tx            → { status: "accepted", tx_hash }
 *
 * Circle deployment and execution are NOT available via REST today.
 * Circles run in sealed browser environments accessed via the
 * window.OctraCircle.request() browser API, deployed through light-node CLI.
 * See circle.ts for the clean interface with honest mocks.
 */

import axios, { type AxiosInstance, isAxiosError } from 'axios';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa';
import { sha3_256 } from '@noble/hashes/sha3';
import type { PQCKeypair } from '@noisebound/pqc-wallet';
import type { NetworkInfo, CircleTx } from './types.js';

export const OCTRA_TESTNET_URL = 'https://octra.network';

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

export class OctraConnectionError extends Error {
  constructor(message: string, public readonly endpoint: string) {
    super(message);
    this.name = 'OctraConnectionError';
  }
}

export class OctraClient {
  private readonly http: AxiosInstance;

  constructor(
    public readonly rpcUrl: string,
    public readonly keypair: PQCKeypair,
  ) {
    this.http = axios.create({
      baseURL: rpcUrl,
      timeout: 10_000,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * Pings the Octra testnet /staging endpoint and measures latency.
   *
   * Throws OctraConnectionError with a clear diagnostic message when the
   * network is unreachable — never returns a partially-valid NetworkInfo.
   */
  async getNetworkInfo(): Promise<NetworkInfo> {
    const t0 = Date.now();
    try {
      const response = await this.http.get<{ staged_transactions?: unknown[] }>('/staging');
      return {
        endpoint: this.rpcUrl,
        stagedTransactions: response.data.staged_transactions?.length ?? 0,
        reachable: true,
        latencyMs: Date.now() - t0,
      };
    } catch (err) {
      const detail = isAxiosError(err)
        ? `HTTP ${err.response?.status ?? 'timeout'}: ${err.message}`
        : String(err);
      throw new OctraConnectionError(
        `Octra testnet unreachable at ${this.rpcUrl} — ${detail}. ` +
          `Check network connectivity or run a local node on http://127.0.0.1:18081.`,
        this.rpcUrl,
      );
    }
  }

  /**
   * Returns the balance of an Octra address in μOCT.
   * (1 OCT = 1_000_000 μOCT, matching Octra's internal unit.)
   * Returns 0n for addresses not yet on-chain.
   */
  async getBalance(address: string): Promise<bigint> {
    try {
      const response = await this.http.get<{ balance?: number | string; nonce?: number }>(
        `/balance/${address}`,
      );
      const raw = response.data.balance ?? 0;
      const octFloat = typeof raw === 'string' ? parseFloat(raw) : raw;
      return BigInt(Math.round(octFloat * 1_000_000));
    } catch (err) {
      if (isAxiosError(err) && err.response?.status === 404) return 0n;
      throw err;
    }
  }

  /**
   * Signs and sends a transaction to the Octra network.
   * Returns the transaction hash on acceptance.
   *
   * Signing: SHA3-256 of the canonical JSON → ML-DSA-65 signature.
   * The pqcSignature and pqcPublicKey fields carry Veil's identity layer.
   *
   * TODO: Octra testnet validates Ed25519 (NaCl) signatures for standard txs.
   * This method will work for Veil-aware nodes but currently fails on vanilla
   * Octra testnet. Wire in Ed25519 signing once Octra SDK matures or when
   * PQC signing support is added to Octra's protocol.
   */
  async sendTransaction(tx: CircleTx): Promise<string> {
    const canonical = canonicalizeTx(tx);
    const msgHash = sha3_256(new TextEncoder().encode(canonical));
    const signature = ml_dsa65.sign(this.keypair.signingKey, msgHash);

    const payload = {
      from: tx.from,
      to_: tx.to,          // Octra uses "to_" not "to" in the wire format
      amount: tx.amount,
      nonce: tx.nonce,
      ou: tx.ou,
      timestamp: tx.timestamp,
      ...(tx.message ? { message: tx.message } : {}),
      pqcSignature: toHex(signature),
      pqcPublicKey: toHex(this.keypair.publicKey.dsa),
    };

    const response = await this.http.post<{ status?: string; tx_hash?: string }>(
      '/send-tx',
      payload,
    );

    const txHash = response.data.tx_hash;
    if (!txHash) {
      throw new Error(
        `Octra /send-tx: unexpected response ${JSON.stringify(response.data)}`,
      );
    }
    return txHash;
  }
}

function canonicalizeTx(tx: CircleTx): string {
  const fields: Record<string, unknown> = {
    amount: tx.amount,
    from: tx.from,
    nonce: tx.nonce,
    ou: tx.ou,
    timestamp: tx.timestamp,
    to: tx.to,
  };
  if (tx.message) fields.message = tx.message;
  // Deterministic key order
  return JSON.stringify(
    Object.fromEntries(Object.keys(fields).sort().map(k => [k, fields[k]])),
  );
}
