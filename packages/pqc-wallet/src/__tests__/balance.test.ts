import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ENV_VAR_NAME = 'NEXT_PUBLIC_NOISEBOUND_NETWORK';
const originalValue = process.env[ENV_VAR_NAME];

const getBalanceMock = vi.fn();
const balanceOfMock = vi.fn();
const jsonRpcProviderCtor = vi.fn();
const contractCtor = vi.fn();

vi.mock('ethers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ethers')>();
  return {
    ...actual,
    JsonRpcProvider: vi.fn().mockImplementation((...args: unknown[]) => {
      jsonRpcProviderCtor(...args);
      return { getBalance: getBalanceMock };
    }),
    Contract: vi.fn().mockImplementation((...args: unknown[]) => {
      contractCtor(...args);
      return { balanceOf: balanceOfMock };
    }),
  };
});

describe('fetchNativeBalance / fetchERC20Balance', () => {
  beforeEach(() => {
    process.env[ENV_VAR_NAME] = 'base-sepolia';
    getBalanceMock.mockReset().mockResolvedValue(123456789n);
    balanceOfMock.mockReset().mockResolvedValue(42n);
    jsonRpcProviderCtor.mockReset();
    contractCtor.mockReset();
  });

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env[ENV_VAR_NAME];
    } else {
      process.env[ENV_VAR_NAME] = originalValue;
    }
  });

  it('fetches the native balance using the active network RPC URL and chain id', async () => {
    const { fetchNativeBalance } = await import('../balance.js');
    const address = '0x000000000000000000000000000000000000AA';

    const balance = await fetchNativeBalance(address);

    expect(balance).toBe(123456789n);
    expect(jsonRpcProviderCtor).toHaveBeenCalledWith('https://sepolia.base.org', 84532);
    expect(getBalanceMock).toHaveBeenCalledWith(address);
  });

  it('fetches the ERC-20 balance against the given token address using the active network RPC', async () => {
    const { fetchERC20Balance } = await import('../balance.js');
    const address = '0x000000000000000000000000000000000000AA';
    const tokenAddress = '0x000000000000000000000000000000000000BB';

    const balance = await fetchERC20Balance(address, tokenAddress);

    expect(balance).toBe(42n);
    expect(jsonRpcProviderCtor).toHaveBeenCalledWith('https://sepolia.base.org', 84532);
    expect(contractCtor).toHaveBeenCalledWith(
      tokenAddress,
      ['function balanceOf(address owner) view returns (uint256)'],
      expect.anything(),
    );
    expect(balanceOfMock).toHaveBeenCalledWith(address);
  });

  it('switches RPC URL and chain id when the active network changes to base-mainnet', async () => {
    process.env[ENV_VAR_NAME] = 'base-mainnet';
    const { fetchNativeBalance } = await import('../balance.js');

    await fetchNativeBalance('0x000000000000000000000000000000000000AA');

    expect(jsonRpcProviderCtor).toHaveBeenCalledWith('https://mainnet.base.org', 8453);
  });
});
