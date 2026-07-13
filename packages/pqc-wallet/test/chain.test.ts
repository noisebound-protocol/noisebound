import { describe, it, expect, vi } from 'vitest';
import { ethers } from 'ethers';
import {
  fetchNativeBalance,
  fetchERC20Balance,
  createExecutionSigner,
  createBaseProvider,
} from '../src/chain.js';
import { CHAIN_REGISTRY } from '../src/networks.js';

describe('fetchNativeBalance', () => {
  it('returns the provider-reported balance', async () => {
    const provider = { getBalance: vi.fn().mockResolvedValue(2_500_000_000_000_000_000n) };
    const balance = await fetchNativeBalance('0xabc', provider as unknown as ethers.Provider);

    expect(provider.getBalance).toHaveBeenCalledWith('0xabc');
    expect(balance).toBe(2_500_000_000_000_000_000n);
  });
});

describe('fetchERC20Balance', () => {
  it('decodes balanceOf() via a minimal ERC-20 contract call', async () => {
    const provider = {
      call: vi.fn().mockResolvedValue(
        ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [100_000_000n]),
      ),
      resolveName: vi.fn(async (address: string) => address),
    };

    const balance = await fetchERC20Balance(
      '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      '0x000000000000000000000000000000000000dEaD',
      provider as unknown as ethers.Provider,
    );

    expect(provider.call).toHaveBeenCalled();
    expect(balance).toBe(100_000_000n);
  });
});

describe('createExecutionSigner', () => {
  it('produces a valid checksummed secp256k1 address', () => {
    const signer = createExecutionSigner();
    expect(ethers.isAddress(signer.address)).toBe(true);
  });

  it('produces a distinct key on every call', () => {
    const a = createExecutionSigner();
    const b = createExecutionSigner();
    expect(a.address).not.toBe(b.address);
    expect(a.privateKey).not.toBe(b.privateKey);
  });

  it('connects to the given provider when supplied', () => {
    const provider = createBaseProvider();
    const signer = createExecutionSigner(provider);
    expect(signer.provider).toBe(provider);
  });
});

describe('createBaseProvider', () => {
  it('defaults to the active network\'s RPC (base-sepolia in tests)', () => {
    const provider = createBaseProvider();
    expect(provider._getConnection().url).toBe(CHAIN_REGISTRY['base-sepolia'].rpcUrl);
  });

  it('accepts a custom RPC URL, bypassing the active network', () => {
    const provider = createBaseProvider('https://custom.rpc.example');
    expect(provider._getConnection().url).toBe('https://custom.rpc.example');
  });
});