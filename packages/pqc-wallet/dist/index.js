import { ml_dsa65 } from '@noble/post-quantum/ml-dsa';
import { ml_kem768 } from '@noble/post-quantum/ml-kem';
import { keccak_256 } from '@noble/hashes/sha3';
import { ethers, AbstractSigner } from 'ethers';

// src/keypair.ts
function toHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
function generatePQCKeypair() {
  const dsaKeys = ml_dsa65.keygen(crypto.getRandomValues(new Uint8Array(32)));
  const kemKeys = ml_kem768.keygen(crypto.getRandomValues(new Uint8Array(64)));
  const hash = keccak_256(dsaKeys.publicKey);
  const address = "0x" + toHex(hash.slice(12));
  return {
    signingKey: dsaKeys.secretKey,
    encapsulationKey: kemKeys.secretKey,
    publicKey: {
      dsa: dsaKeys.publicKey,
      kem: kemKeys.publicKey
    },
    address
  };
}
function signTransaction(tx, signingKey) {
  const txObj = ethers.Transaction.from(tx);
  const txBytes = ethers.getBytes(txObj.unsignedSerialized);
  const msgHash = keccak_256(txBytes);
  return ml_dsa65.sign(signingKey, msgHash);
}
function verifyTransactionSignature(tx, signature, publicKey) {
  const txObj = ethers.Transaction.from(tx);
  const txBytes = ethers.getBytes(txObj.unsignedSerialized);
  const msgHash = keccak_256(txBytes);
  return ml_dsa65.verify(publicKey, msgHash, signature);
}
function encapsulateKey(recipientPublicKey) {
  const { cipherText, sharedSecret } = ml_kem768.encapsulate(recipientPublicKey);
  return { ciphertext: cipherText, sharedSecret };
}
function decapsulateKey(ciphertext, encapsulationKey) {
  return ml_kem768.decapsulate(ciphertext, encapsulationKey);
}
function toHex2(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
function fromHex(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}
function createX402PQCHeader(amount, recipient, signingKey) {
  const payload = {
    version: "pqc-1",
    amount,
    recipient,
    timestamp: Date.now(),
    nonce: toHex2(crypto.getRandomValues(new Uint8Array(16)))
  };
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
  const signature = ml_dsa65.sign(signingKey, payloadBytes);
  const fullHeader = { ...payload, signature: toHex2(signature) };
  return btoa(JSON.stringify(fullHeader));
}
function verifyX402PQCHeader(headerB64, publicKey) {
  try {
    const full = JSON.parse(atob(headerB64));
    const { signature, ...payload } = full;
    const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
    return ml_dsa65.verify(publicKey, payloadBytes, fromHex(signature));
  } catch {
    return false;
  }
}
var WalletProvider = class _WalletProvider extends AbstractSigner {
  #keypair;
  constructor(keypair, provider) {
    super(provider ?? null);
    this.#keypair = keypair;
  }
  async getAddress() {
    return this.#keypair.address;
  }
  async signMessage(message) {
    const msgBytes = typeof message === "string" ? new TextEncoder().encode(message) : message;
    const sig = ml_dsa65.sign(this.#keypair.signingKey, msgBytes);
    return ethers.hexlify(sig);
  }
  async signTransaction(tx) {
    const txObj = ethers.Transaction.from(tx);
    const txBytes = ethers.getBytes(txObj.unsignedSerialized);
    const msgHash = keccak_256(txBytes);
    const sig = ml_dsa65.sign(this.#keypair.signingKey, msgHash);
    return ethers.hexlify(sig);
  }
  async signTypedData(domain, types, value) {
    const hash = ethers.TypedDataEncoder.hash(domain, types, value);
    const hashBytes = ethers.getBytes(hash);
    const sig = ml_dsa65.sign(this.#keypair.signingKey, hashBytes);
    return ethers.hexlify(sig);
  }
  connect(provider) {
    return new _WalletProvider(this.#keypair, provider);
  }
};

// src/networks.ts
var CHAIN_REGISTRY = {
  "base-mainnet": {
    chainId: 8453,
    rpcUrl: "https://mainnet.base.org",
    usdcAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    displayName: "Base Mainnet"
  },
  "base-sepolia": {
    chainId: 84532,
    rpcUrl: "https://sepolia.base.org",
    usdcAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    displayName: "Base Sepolia"
  }
};
function getActiveNetwork() {
  const key = process.env.NEXT_PUBLIC_NOISEBOUND_NETWORK;
  if (!key || !(key in CHAIN_REGISTRY)) {
    const known = Object.keys(CHAIN_REGISTRY).join(", ");
    throw new Error(
      `NEXT_PUBLIC_NOISEBOUND_NETWORK must be set to one of: ${known}. Got: ${key ?? "(unset)"}`
    );
  }
  return CHAIN_REGISTRY[key];
}

// src/chain.ts
var ERC20_BALANCE_OF_ABI = [
  "function balanceOf(address account) view returns (uint256)"
];
function createBaseProvider(rpcUrl) {
  return new ethers.JsonRpcProvider(rpcUrl ?? getActiveNetwork().rpcUrl);
}
async function fetchNativeBalance(address, provider) {
  return provider.getBalance(address);
}
async function fetchERC20Balance(tokenAddress, holderAddress, provider) {
  const token = new ethers.Contract(tokenAddress, ERC20_BALANCE_OF_ABI, provider);
  const balance = await token.balanceOf(holderAddress);
  return balance;
}
function createExecutionSigner(provider) {
  const wallet = ethers.Wallet.createRandom();
  return provider ? wallet.connect(provider) : wallet;
}

export { CHAIN_REGISTRY, WalletProvider, createBaseProvider, createExecutionSigner, createX402PQCHeader, decapsulateKey, encapsulateKey, fetchERC20Balance, fetchNativeBalance, generatePQCKeypair, getActiveNetwork, signTransaction, verifyTransactionSignature, verifyX402PQCHeader };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map