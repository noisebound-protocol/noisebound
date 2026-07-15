import { ethers, AbstractSigner } from 'ethers';

interface PQCPublicKey {
    /** ML-DSA-65 verification key (1952 bytes) */
    dsa: Uint8Array;
    /** ML-KEM-768 encapsulation key (1184 bytes) */
    kem: Uint8Array;
}
interface PQCKeypair {
    /** ML-DSA-65 signing secret key (4032 bytes) */
    signingKey: Uint8Array;
    /** ML-KEM-768 decapsulation secret key (2400 bytes) */
    encapsulationKey: Uint8Array;
    publicKey: PQCPublicKey;
    /** EVM-compatible address derived from keccak256(dsa public key)[-20 bytes] */
    address: string;
}
interface X402PQCHeader {
    version: string;
    amount: string;
    recipient: string;
    timestamp: number;
    nonce: string;
    signature: string;
}

/**
 * Generates an ML-DSA-65 signing keypair + ML-KEM-768 encapsulation keypair.
 * The address is derived as the last 20 bytes of keccak256(dsa public key),
 * analogous to how Ethereum derives addresses from ECDSA public keys.
 */
declare function generatePQCKeypair(): PQCKeypair;

/**
 * Signs an EVM transaction with ML-DSA-65.
 * Serializes the unsigned transaction, hashes with keccak256, then signs.
 * Returns raw ML-DSA-65 signature bytes (not EVM-compatible — for PQC chains).
 */
declare function signTransaction(tx: ethers.TransactionLike, signingKey: Uint8Array): Uint8Array;
/**
 * Verifies an ML-DSA-65 signature over a serialized EVM transaction.
 */
declare function verifyTransactionSignature(tx: ethers.TransactionLike, signature: Uint8Array, publicKey: Uint8Array): boolean;

/**
 * ML-KEM-768 key encapsulation.
 * Given a recipient's KEM public key, produces a ciphertext and a shared secret.
 * Send the ciphertext to the recipient; both parties derive the same sharedSecret.
 */
declare function encapsulateKey(recipientPublicKey: Uint8Array): {
    ciphertext: Uint8Array;
    sharedSecret: Uint8Array;
};
/**
 * ML-KEM-768 key decapsulation.
 * Given the ciphertext from encapsulation and the recipient's KEM secret key,
 * recovers the same sharedSecret the sender computed.
 */
declare function decapsulateKey(ciphertext: Uint8Array, encapsulationKey: Uint8Array): Uint8Array;

/**
 * Creates a quantum-resistant x402 payment header signed with ML-DSA-65.
 * The payload (amount, recipient, timestamp, nonce) is signed before encoding,
 * so any field tampering invalidates the signature.
 *
 * The verifier must supply the sender's DSA public key out-of-band
 * (e.g., resolved from an on-chain registry by the sender's address).
 */
declare function createX402PQCHeader(amount: string, recipient: string, signingKey: Uint8Array): string;
/**
 * Verifies a PQC-signed x402 payment header.
 * Strips the signature field, re-serializes the payload in the original key order,
 * and verifies with ML-DSA-65.
 */
declare function verifyX402PQCHeader(headerB64: string, publicKey: Uint8Array): boolean;

/**
 * ethers.js AbstractSigner implementation backed by ML-DSA-65.
 *
 * Standard EVM chains use secp256k1 ECDSA — this provider targets PQC-capable
 * chains or rollups that accept ML-DSA-65 signatures. The returned signature
 * hex strings are raw ML-DSA-65 bytes, not EVM-serialized transactions.
 */
declare class WalletProvider extends AbstractSigner {
    #private;
    constructor(keypair: PQCKeypair, provider?: ethers.Provider | null);
    getAddress(): Promise<string>;
    signMessage(message: string | Uint8Array): Promise<string>;
    signTransaction(tx: ethers.TransactionRequest): Promise<string>;
    signTypedData(domain: ethers.TypedDataDomain, types: Record<string, ethers.TypedDataField[]>, value: Record<string, unknown>): Promise<string>;
    connect(provider: ethers.Provider | null): WalletProvider;
}

/**
 * Connects to the active network (see networks.ts) by default. Pass an
 * explicit rpcUrl to override — e.g. for tests or a custom endpoint — without
 * needing NEXT_PUBLIC_NOISEBOUND_NETWORK set.
 */
declare function createBaseProvider(rpcUrl?: string): ethers.JsonRpcProvider;
declare function fetchNativeBalance(address: string, provider: ethers.Provider): Promise<bigint>;
declare function fetchERC20Balance(tokenAddress: string, holderAddress: string, provider: ethers.Provider): Promise<bigint>;
/**
 * Creates a fresh, randomly-generated secp256k1 signer for on-chain execution.
 * Base mainnet only accepts secp256k1 ECDSA signatures — the ML-DSA-65 wallet
 * identity cannot sign transactions directly. This ephemeral key is what a
 * capability token (see @noisebound/x402-pqc) authorizes to actually broadcast,
 * scoped and time-boxed. Freshly random per session, not derived from the
 * wallet seed, so compromising one session's key reveals nothing about the
 * seed or other sessions.
 */
declare function createExecutionSigner(provider?: ethers.Provider): ethers.HDNodeWallet;

interface NetworkConfig {
    chainId: number;
    rpcUrl: string;
    /** Circle's official USDC contract for this network. */
    usdcAddress: string;
    displayName: string;
}
/**
 * Chain registry. Sepolia's USDC address is Circle's official testnet
 * contract (developers.circle.com/stablecoins/usdc-contract-addresses),
 * not a guess or a random ERC-20 — verified against BaseScan's checksum.
 */
declare const CHAIN_REGISTRY: {
    readonly 'base-mainnet': {
        readonly chainId: 8453;
        readonly rpcUrl: "https://mainnet.base.org";
        readonly usdcAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
        readonly displayName: "Base Mainnet";
    };
    readonly 'base-sepolia': {
        readonly chainId: 84532;
        readonly rpcUrl: "https://sepolia.base.org";
        readonly usdcAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
        readonly displayName: "Base Sepolia";
    };
};
type NetworkKey = keyof typeof CHAIN_REGISTRY;
/**
 * Resolves the active network from NEXT_PUBLIC_NOISEBOUND_NETWORK. There is
 * no fallback to mainnet — an unset or unrecognized value throws immediately.
 * Mainnet must only ever be selected by explicit, intentional configuration.
 */
declare function getActiveNetwork(): NetworkConfig;

export { CHAIN_REGISTRY, type NetworkConfig, type NetworkKey, type PQCKeypair, type PQCPublicKey, WalletProvider, type X402PQCHeader, createBaseProvider, createExecutionSigner, createX402PQCHeader, decapsulateKey, encapsulateKey, fetchERC20Balance, fetchNativeBalance, generatePQCKeypair, getActiveNetwork, signTransaction, verifyTransactionSignature, verifyX402PQCHeader };
