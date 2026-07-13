import { ethers } from 'ethers';
import { getActiveNetwork } from './networks.js';

const ERC20_BALANCE_OF_ABI = [
  'function balanceOf(address account) view returns (uint256)',
];

/**
 * Connects to the active network (see networks.ts) by default. Pass an
 * explicit rpcUrl to override — e.g. for tests or a custom endpoint — without
 * needing NEXT_PUBLIC_NOISEBOUND_NETWORK set.
 */
export function createBaseProvider(rpcUrl?: string): ethers.JsonRpcProvider {
  return new ethers.JsonRpcProvider(rpcUrl ?? getActiveNetwork().rpcUrl);
}

export async function fetchNativeBalance(
  address: string,
  provider: ethers.Provider,
): Promise<bigint> {
  return provider.getBalance(address);
}

export async function fetchERC20Balance(
  tokenAddress: string,
  holderAddress: string,
  provider: ethers.Provider,
): Promise<bigint> {
  const token = new ethers.Contract(tokenAddress, ERC20_BALANCE_OF_ABI, provider);
  const balance: bigint = await token.balanceOf(holderAddress);
  return balance;
}

/**
 * Creates a fresh, randomly-generated secp256k1 signer for on-chain execution.
 * Base mainnet only accepts secp256k1 ECDSA signatures — the ML-DSA-65 wallet
 * identity cannot sign transactions directly. This ephemeral key is what a
 * capability token (see @noisebound/x402-pqc) authorizes to actually broadcast,
 * scoped and time-boxed. Freshly random per session, not derived from the
 * wallet seed, so compromising one session's key reveals nothing about the
 * seed or other sessions.
 */
export function createExecutionSigner(provider?: ethers.Provider): ethers.HDNodeWallet {
  const wallet = ethers.Wallet.createRandom();
  return provider ? wallet.connect(provider) : wallet;
}