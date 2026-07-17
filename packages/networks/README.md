# @noisebound/networks

Chain registry and active-network resolution for Base mainnet and Base Sepolia.

This package holds the static configuration (chain ID, RPC URL, USDC contract address, display name) for the two supported networks, and resolves which network is "active" at runtime by reading the `NEXT_PUBLIC_NOISEBOUND_NETWORK` environment variable. It has no runtime dependencies.

## API

- `NetworkName` — type: `'base-mainnet' | 'base-sepolia'`.
- `NetworkConfig` — type: `{ chainId: number; rpcUrl: string; usdcAddress: \`0x${string}\`; displayName: string }`.
- `NETWORK_NAMES: readonly NetworkName[]` — the list of valid network names, `['base-mainnet', 'base-sepolia']`.
- `CHAIN_REGISTRY: Readonly<Record<NetworkName, NetworkConfig>>` — static config for each supported network (chain ID, RPC URL, USDC address, display name).
- `isNetworkName(value: string): value is NetworkName` — type guard checking whether a string is one of the supported network names.
- `getActiveNetwork(): NetworkConfig` — reads `NEXT_PUBLIC_NOISEBOUND_NETWORK` from `process.env` and returns the matching `NetworkConfig` from `CHAIN_REGISTRY`. Throws if the variable is unset, empty, or not a recognized network name.

## Usage

```ts
import { getActiveNetwork } from '@noisebound/networks';

// requires process.env.NEXT_PUBLIC_NOISEBOUND_NETWORK to be 'base-mainnet' or 'base-sepolia'
const network = getActiveNetwork();
// { chainId: 8453, rpcUrl: 'https://mainnet.base.org', usdcAddress: '0x8335...', displayName: 'Base' }
```
