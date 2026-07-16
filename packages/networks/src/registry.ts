export type NetworkName = 'base-mainnet' | 'base-sepolia';

export interface NetworkConfig {
  readonly chainId: number;
  readonly rpcUrl: string;
  readonly usdcAddress: `0x${string}`;
  readonly displayName: string;
}

export const NETWORK_NAMES: readonly NetworkName[] = ['base-mainnet', 'base-sepolia'];

// USDC addresses verified against https://developers.circle.com/stablecoins/usdc-contract-addresses
export const CHAIN_REGISTRY: Readonly<Record<NetworkName, NetworkConfig>> = {
  'base-mainnet': {
    chainId: 8453,
    rpcUrl: 'https://mainnet.base.org',
    usdcAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    displayName: 'Base',
  },
  'base-sepolia': {
    chainId: 84532,
    rpcUrl: 'https://sepolia.base.org',
    usdcAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    displayName: 'Base Sepolia',
  },
};

export function isNetworkName(value: string): value is NetworkName {
  return (NETWORK_NAMES as readonly string[]).includes(value);
}
