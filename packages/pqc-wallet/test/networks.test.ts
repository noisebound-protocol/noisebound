import { describe, it, expect, afterEach } from 'vitest';
import { CHAIN_REGISTRY, getActiveNetwork } from '../src/networks.js';

const ORIGINAL = process.env.NEXT_PUBLIC_NOISEBOUND_NETWORK;

afterEach(() => {
  if (ORIGINAL === undefined) {
    delete process.env.NEXT_PUBLIC_NOISEBOUND_NETWORK;
  } else {
    process.env.NEXT_PUBLIC_NOISEBOUND_NETWORK = ORIGINAL;
  }
});

describe('CHAIN_REGISTRY', () => {
  it('base-mainnet resolves to the correct chain ID and USDC address', () => {
    expect(CHAIN_REGISTRY['base-mainnet']).toEqual({
      chainId: 8453,
      rpcUrl: 'https://mainnet.base.org',
      usdcAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      displayName: 'Base Mainnet',
    });
  });

  it('base-sepolia resolves to the correct chain ID and USDC address', () => {
    expect(CHAIN_REGISTRY['base-sepolia']).toEqual({
      chainId: 84532,
      rpcUrl: 'https://sepolia.base.org',
      usdcAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
      displayName: 'Base Sepolia',
    });
  });
});

describe('getActiveNetwork', () => {
  it('resolves base-mainnet when explicitly configured', () => {
    process.env.NEXT_PUBLIC_NOISEBOUND_NETWORK = 'base-mainnet';
    expect(getActiveNetwork()).toEqual(CHAIN_REGISTRY['base-mainnet']);
  });

  it('resolves base-sepolia when explicitly configured', () => {
    process.env.NEXT_PUBLIC_NOISEBOUND_NETWORK = 'base-sepolia';
    expect(getActiveNetwork()).toEqual(CHAIN_REGISTRY['base-sepolia']);
  });

  it('throws rather than defaulting to mainnet when the env var is unset', () => {
    delete process.env.NEXT_PUBLIC_NOISEBOUND_NETWORK;
    expect(() => getActiveNetwork()).toThrow(/NEXT_PUBLIC_NOISEBOUND_NETWORK/);
  });

  it('throws rather than defaulting to mainnet when the env var is unrecognized', () => {
    process.env.NEXT_PUBLIC_NOISEBOUND_NETWORK = 'ethereum-mainnet';
    expect(() => getActiveNetwork()).toThrow(/NEXT_PUBLIC_NOISEBOUND_NETWORK/);
  });

  it('never silently returns mainnet config on failure', () => {
    delete process.env.NEXT_PUBLIC_NOISEBOUND_NETWORK;
    let result: unknown;
    try {
      result = getActiveNetwork();
    } catch {
      result = undefined;
    }
    expect(result).toBeUndefined();
  });
});