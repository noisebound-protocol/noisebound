import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchNativeBalanceMock = vi.fn<(address: string) => Promise<bigint>>();

vi.mock('@noisebound/pqc-wallet', () => ({
  fetchNativeBalance: (address: string) => fetchNativeBalanceMock(address),
}));

vi.mock('ethers', () => ({
  Wallet: class {
    readonly address: string;
    constructor(privateKey: string) {
      this.address = `address-for-${privateKey}`;
    }
  },
}));

describe('createFunderBalanceCheck', () => {
  const ORIGINAL_ENV = process.env.NOISEBOUND_DEV_FUNDER_PRIVATE_KEY;

  beforeEach(() => {
    process.env.NOISEBOUND_DEV_FUNDER_PRIVATE_KEY = '0xdeadbeef';
    fetchNativeBalanceMock.mockReset();
  });

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env.NOISEBOUND_DEV_FUNDER_PRIVATE_KEY;
    } else {
      process.env.NOISEBOUND_DEV_FUNDER_PRIVATE_KEY = ORIGINAL_ENV;
    }
  });

  it('reports the funder wallet native balance in wei as a string', async () => {
    const { createFunderBalanceCheck } = await import('../checks');
    fetchNativeBalanceMock.mockResolvedValue(5_000_000_000_000_000n);

    const check = createFunderBalanceCheck();
    const value = await check.run({ now: () => new Date() });

    expect(value).toBe('5000000000000000');
    expect(fetchNativeBalanceMock).toHaveBeenCalledWith('address-for-0xdeadbeef');
  });

  it('fires an inaction-costs-money event only when balance crosses below the low threshold', async () => {
    const { createFunderBalanceCheck } = await import('../checks');
    const check = createFunderBalanceCheck();

    const noCross = check.onResult?.('5000000000000000', '2000000000000000', { now: () => new Date() });
    expect(noCross).toBeUndefined();

    const crossed = check.onResult?.('5000000000000000', '500000000000000', { now: () => new Date() });
    expect(crossed).toEqual({ id: 'dev-funder-native-balance-low', kind: 'inaction-costs-money' });

    const staysLow = check.onResult?.('500000000000000', '100000000000000', { now: () => new Date() });
    expect(staysLow).toBeUndefined();
  });
});
