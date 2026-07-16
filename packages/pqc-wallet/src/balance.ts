import { Contract, JsonRpcProvider } from 'ethers';
import { getActiveNetwork } from '@noisebound/networks';

const ERC20_BALANCE_OF_ABI = ['function balanceOf(address owner) view returns (uint256)'];

function getProvider(): JsonRpcProvider {
  const network = getActiveNetwork();
  return new JsonRpcProvider(network.rpcUrl, network.chainId);
}

/** Fetches the native (ETH) balance of an address on the currently active network. */
export async function fetchNativeBalance(address: string): Promise<bigint> {
  const provider = getProvider();
  return provider.getBalance(address);
}

/** Fetches an ERC-20 token balance of an address on the currently active network. */
export async function fetchERC20Balance(address: string, tokenAddress: string): Promise<bigint> {
  const provider = getProvider();
  const contract = new Contract(tokenAddress, ERC20_BALANCE_OF_ABI, provider);
  const balance: unknown = await contract.balanceOf!(address);
  return BigInt(balance as bigint);
}
