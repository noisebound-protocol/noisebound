export interface NetworkConfig {
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
export const CHAIN_REGISTRY = {
  'base-mainnet': {
    chainId: 8453,
    rpcUrl: 'https://mainnet.base.org',
    usdcAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    displayName: 'Base Mainnet',
  },
  'base-sepolia': {
    chainId: 84532,
    rpcUrl: 'https://sepolia.base.org',
    usdcAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    displayName: 'Base Sepolia',
  },
} as const satisfies Record<string, NetworkConfig>;

export type NetworkKey = keyof typeof CHAIN_REGISTRY;

/**
 * Resolves the active network from NEXT_PUBLIC_NOISEBOUND_NETWORK. There is
 * no fallback to mainnet — an unset or unrecognized value throws immediately.
 * Mainnet must only ever be selected by explicit, intentional configuration.
 */
export function getActiveNetwork(): NetworkConfig {
  const key = process.env.NEXT_PUBLIC_NOISEBOUND_NETWORK;
  if (!key || !(key in CHAIN_REGISTRY)) {
    const known = Object.keys(CHAIN_REGISTRY).join(', ');
    throw new Error(
      `NEXT_PUBLIC_NOISEBOUND_NETWORK must be set to one of: ${known}. Got: ${key ?? '(unset)'}`,
    );
  }
  return CHAIN_REGISTRY[key as NetworkKey];
}