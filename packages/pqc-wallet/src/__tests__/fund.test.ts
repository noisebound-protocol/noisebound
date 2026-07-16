import { generateIdentityKeyPair } from '@noisebound/identity';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FunderWallet, SessionCapabilityScope } from '../types.js';

const ENV_VAR_NAME = 'NEXT_PUBLIC_NOISEBOUND_NETWORK';
const originalValue = process.env[ENV_VAR_NAME];

const sendTransactionMock = vi.fn();
const jsonRpcProviderCtor = vi.fn();
const walletCtor = vi.fn();

vi.mock('ethers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ethers')>();
  const WalletMock = vi.fn().mockImplementation((...args: unknown[]) => {
    walletCtor(...args);
    return { sendTransaction: sendTransactionMock };
  });
  // Preserve static methods (e.g. Wallet.createRandom, used by generateSessionKey)
  // which live on the class's own prototype chain, not as enumerable own properties.
  Object.setPrototypeOf(WalletMock, actual.Wallet);

  return {
    ...actual,
    JsonRpcProvider: vi.fn().mockImplementation((...args: unknown[]) => {
      jsonRpcProviderCtor(...args);
      return { __brand: 'provider' };
    }),
    Wallet: WalletMock,
  };
});

const funderWallet: FunderWallet = {
  privateKey: '0x1111111111111111111111111111111111111111111111111111111111111111' as `0x${string}`,
};

const sessionAddress = '0x000000000000000000000000000000000000AA' as const;
const scope: SessionCapabilityScope = { maxSpendWei: '1000000000000000000' };

describe('fundSessionKey', () => {
  beforeEach(() => {
    process.env[ENV_VAR_NAME] = 'base-sepolia';
    sendTransactionMock.mockReset().mockResolvedValue({ hash: '0xdeadbeef' });
    jsonRpcProviderCtor.mockReset();
    walletCtor.mockReset();
  });

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env[ENV_VAR_NAME];
    } else {
      process.env[ENV_VAR_NAME] = originalValue;
    }
  });

  it('sends the correct amount to the correct address using the active network RPC', async () => {
    const { fundSessionKey } = await import('../fund.js');
    const amountWei = 500_000_000_000_000n;

    const txHash = await fundSessionKey(funderWallet, sessionAddress, amountWei);

    expect(txHash).toBe('0xdeadbeef');
    expect(jsonRpcProviderCtor).toHaveBeenCalledWith('https://sepolia.base.org', 84532);
    expect(walletCtor).toHaveBeenCalledWith(funderWallet.privateKey, expect.anything());
    expect(sendTransactionMock).toHaveBeenCalledWith({
      to: sessionAddress,
      value: amountWei,
    });
  });

  it('surfaces an RPC failure as a typed SessionFundingError rather than swallowing it', async () => {
    const { fundSessionKey, SessionFundingError } = await import('../fund.js');
    sendTransactionMock.mockReset().mockRejectedValue(new Error('insufficient funds'));

    await expect(fundSessionKey(funderWallet, sessionAddress, 1n)).rejects.toThrow(
      SessionFundingError,
    );
    await expect(fundSessionKey(funderWallet, sessionAddress, 1n)).rejects.toThrow(
      /insufficient funds/,
    );
  });
});

describe('issueAndFundSessionCapability', () => {
  beforeEach(() => {
    process.env[ENV_VAR_NAME] = 'base-sepolia';
    sendTransactionMock.mockReset().mockResolvedValue({ hash: '0xdeadbeef' });
    jsonRpcProviderCtor.mockReset();
    walletCtor.mockReset();
  });

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env[ENV_VAR_NAME];
    } else {
      process.env[ENV_VAR_NAME] = originalValue;
    }
  });

  it('issues the capability then funds the resulting session address, returning both', async () => {
    const { issueAndFundSessionCapability } = await import('../fund.js');
    const { generateSessionKey } = await import('../sessionKey.js');
    const identityKeyPair = generateIdentityKeyPair();
    const sessionKey = generateSessionKey();
    const amountWei = 250_000_000_000_000n;

    const result = await issueAndFundSessionCapability(
      identityKeyPair,
      sessionKey.publicKey,
      scope,
      60_000,
      funderWallet,
      amountWei,
    );

    expect(result.capability.payload.sessionAddress).toBe(sessionKey.address);
    expect(result.fundingTxHash).toBe('0xdeadbeef');
    expect(sendTransactionMock).toHaveBeenCalledWith({
      to: sessionKey.address,
      value: amountWei,
    });
  });

  it('propagates a typed funding error without swallowing it, even though the capability was issued', async () => {
    const { issueAndFundSessionCapability, SessionFundingError } = await import('../fund.js');
    const { generateSessionKey } = await import('../sessionKey.js');
    sendTransactionMock.mockReset().mockRejectedValue(new Error('network unreachable'));
    const identityKeyPair = generateIdentityKeyPair();
    const sessionKey = generateSessionKey();

    await expect(
      issueAndFundSessionCapability(
        identityKeyPair,
        sessionKey.publicKey,
        scope,
        60_000,
        funderWallet,
        1n,
      ),
    ).rejects.toThrow(SessionFundingError);
  });
});
