import { AbstractSigner, ethers } from 'ethers';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa';
import { keccak_256 } from '@noble/hashes/sha3';
import type { PQCKeypair } from './types.js';

/**
 * ethers.js AbstractSigner implementation backed by ML-DSA-65.
 *
 * Standard EVM chains use secp256k1 ECDSA — this provider targets PQC-capable
 * chains or rollups that accept ML-DSA-65 signatures. The returned signature
 * hex strings are raw ML-DSA-65 bytes, not EVM-serialized transactions.
 */
export class WalletProvider extends AbstractSigner {
  readonly #keypair: PQCKeypair;

  constructor(keypair: PQCKeypair, provider?: ethers.Provider | null) {
    super(provider ?? null);
    this.#keypair = keypair;
  }

  async getAddress(): Promise<string> {
    return this.#keypair.address;
  }

  async signMessage(message: string | Uint8Array): Promise<string> {
    const msgBytes =
      typeof message === 'string' ? new TextEncoder().encode(message) : message;
    const sig = ml_dsa65.sign(this.#keypair.signingKey, msgBytes);
    return ethers.hexlify(sig);
  }

  async signTransaction(tx: ethers.TransactionRequest): Promise<string> {
    const txObj = ethers.Transaction.from(tx as ethers.TransactionLike);
    const txBytes = ethers.getBytes(txObj.unsignedSerialized);
    const msgHash = keccak_256(txBytes);
    const sig = ml_dsa65.sign(this.#keypair.signingKey, msgHash);
    return ethers.hexlify(sig);
  }

  async signTypedData(
    domain: ethers.TypedDataDomain,
    types: Record<string, ethers.TypedDataField[]>,
    value: Record<string, unknown>,
  ): Promise<string> {
    const hash = ethers.TypedDataEncoder.hash(domain, types, value);
    const hashBytes = ethers.getBytes(hash);
    const sig = ml_dsa65.sign(this.#keypair.signingKey, hashBytes);
    return ethers.hexlify(sig);
  }

  connect(provider: ethers.Provider | null): WalletProvider {
    return new WalletProvider(this.#keypair, provider);
  }
}
