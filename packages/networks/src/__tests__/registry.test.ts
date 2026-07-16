import { describe, expect, it } from 'vitest';
import { CHAIN_REGISTRY, isNetworkName } from '../registry.js';

describe('CHAIN_REGISTRY', () => {
  it('has the correct chainId and USDC address for base-mainnet', () => {
    expect(CHAIN_REGISTRY['base-mainnet']).toEqual({
      chainId: 8453,
      rpcUrl: 'https://mainnet.base.org',
      usdcAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      displayName: 'Base',
    });
  });

  it('has the correct chainId and USDC address for base-sepolia', () => {
    expect(CHAIN_REGISTRY['base-sepolia']).toEqual({
      chainId: 84532,
      rpcUrl: 'https://sepolia.base.org',
      usdcAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      displayName: 'Base Sepolia',
    });
  });
});

describe('isNetworkName', () => {
  it('returns true for valid network names', () => {
    expect(isNetworkName('base-mainnet')).toBe(true);
    expect(isNetworkName('base-sepolia')).toBe(true);
  });

  it('returns false for invalid network names', () => {
    expect(isNetworkName('ethereum-mainnet')).toBe(false);
    expect(isNetworkName('')).toBe(false);
  });
});
