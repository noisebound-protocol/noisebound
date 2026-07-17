import { generateIdentityKeyPair } from '@noisebound/identity';
import { generateSessionKey, issueSessionCapability } from '@noisebound/pqc-wallet';
import type { SessionCapabilityScope, SessionKey } from '@noisebound/pqc-wallet';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildOnChainMoneyRequest } from './fixtures.js';

const ENV_VAR_NAME = 'NEXT_PUBLIC_NOISEBOUND_NETWORK';
const originalValue = process.env[ENV_VAR_NAME];

const getTransactionCountMock = vi.fn();
const getFeeDataMock = vi.fn();
const getBalanceMock = vi.fn();
const broadcastTransactionMock = vi.fn();
const jsonRpcProviderCtor = vi.fn();

// Only the RPC transport (JsonRpcProvider) is mocked. `ethers.Wallet` is left
// untouched, so `wallet.signTransaction` below performs a real secp256k1 sign
// against the session key — it is never given a provider, so it cannot make
// network calls even if it wanted to.
vi.mock('ethers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ethers')>();
  return {
    ...actual,
    JsonRpcProvider: vi.fn().mockImplementation((...args: unknown[]) => {
      jsonRpcProviderCtor(...args);
      return {
        getTransactionCount: getTransactionCountMock,
        getFeeData: getFeeDataMock,
        getBalance: getBalanceMock,
        broadcastTransaction: broadcastTransactionMock,
      };
    }),
  };
});

const scope: SessionCapabilityScope = { maxSpendWei: (10n ** 18n).toString() };

function fundedFeeData() {
  return { maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n };
}

describe('createEthersOnChainExecutor', () => {
  beforeEach(() => {
    process.env[ENV_VAR_NAME] = 'base-sepolia';
    getTransactionCountMock.mockReset().mockResolvedValue(7);
    getFeeDataMock.mockReset().mockResolvedValue(fundedFeeData());
    getBalanceMock.mockReset().mockResolvedValue(10n ** 18n);
    broadcastTransactionMock.mockReset().mockResolvedValue({ hash: '0xdeadbeef' });
    jsonRpcProviderCtor.mockReset();
  });

  afterEach(() => {
    if (originalValue === undefined) {
      delete process.env[ENV_VAR_NAME];
    } else {
      process.env[ENV_VAR_NAME] = originalValue;
    }
  });

  async function buildFixture() {
    const { createEthersOnChainExecutor } = await import('../onChainExecutor.js');
    const identityKeyPair = generateIdentityKeyPair();
    const sessionKey = generateSessionKey();
    const capability = issueSessionCapability(identityKeyPair, sessionKey.publicKey, scope, 60_000);
    return { createEthersOnChainExecutor, sessionKey, capability };
  }

  it('signs a real transaction with the session key and broadcasts it, returning the RPC tx hash', async () => {
    const { createEthersOnChainExecutor, sessionKey, capability } = await buildFixture();
    const request = buildOnChainMoneyRequest({ amountWei: 250_000_000_000_000n });

    const executor = createEthersOnChainExecutor((address) =>
      address === sessionKey.address ? sessionKey : undefined,
    );
    const txHash = await executor.send(request, capability);

    expect(txHash).toBe('0xdeadbeef');
    expect(jsonRpcProviderCtor).toHaveBeenCalledWith('https://sepolia.base.org', 84532);

    // Verify the broadcast transaction was really signed by the session key,
    // by parsing the raw signed tx handed to broadcastTransaction with the
    // real (unmocked) ethers Transaction decoder.
    const { Transaction } = await import('ethers');
    const signedTx = broadcastTransactionMock.mock.calls[0]?.[0] as string;
    const parsed = Transaction.from(signedTx);
    expect(parsed.from).toBe(sessionKey.address);
    expect(parsed.to?.toLowerCase()).toBe(request.recipient.toLowerCase());
    expect(parsed.value).toBe(request.amountWei);
    expect(parsed.chainId).toBe(84532n);
  });

  it('throws SessionKeyNotFoundError without touching the RPC when no session key is registered', async () => {
    const { createEthersOnChainExecutor, capability } = await buildFixture();
    const request = buildOnChainMoneyRequest();

    const { SessionKeyNotFoundError } = await import('../onChainExecutor.js');
    const executor = createEthersOnChainExecutor(() => undefined);

    await expect(executor.send(request, capability)).rejects.toThrow(SessionKeyNotFoundError);
    expect(jsonRpcProviderCtor).not.toHaveBeenCalled();
  });

  it('throws SessionKeyNotFoundError when the resolved session key does not match the capability address', async () => {
    const { createEthersOnChainExecutor, capability } = await buildFixture();
    const request = buildOnChainMoneyRequest();
    const wrongKey: SessionKey = generateSessionKey();

    const { SessionKeyNotFoundError } = await import('../onChainExecutor.js');
    const executor = createEthersOnChainExecutor(() => wrongKey);

    await expect(executor.send(request, capability)).rejects.toThrow(SessionKeyNotFoundError);
  });

  it('throws InsufficientBalanceError when the session key cannot cover amount plus gas, without broadcasting', async () => {
    const { createEthersOnChainExecutor, sessionKey, capability } = await buildFixture();
    const request = buildOnChainMoneyRequest({ amountWei: 500_000_000_000_000_000n });
    getBalanceMock.mockReset().mockResolvedValue(1_000n);

    const { InsufficientBalanceError } = await import('../onChainExecutor.js');
    const executor = createEthersOnChainExecutor(() => sessionKey);

    await expect(executor.send(request, capability)).rejects.toThrow(InsufficientBalanceError);
    expect(broadcastTransactionMock).not.toHaveBeenCalled();
  });

  it('surfaces an RPC failure reading account state as a typed OnChainBroadcastError', async () => {
    const { createEthersOnChainExecutor, sessionKey, capability } = await buildFixture();
    const request = buildOnChainMoneyRequest();
    getFeeDataMock.mockReset().mockRejectedValue(new Error('RPC connection refused'));

    const { OnChainBroadcastError } = await import('../onChainExecutor.js');
    const executor = createEthersOnChainExecutor(() => sessionKey);

    await expect(executor.send(request, capability)).rejects.toThrow(OnChainBroadcastError);
    await expect(executor.send(request, capability)).rejects.toThrow(/RPC connection refused/);
  });

  it('surfaces a broadcast rejection as a typed OnChainBroadcastError', async () => {
    const { createEthersOnChainExecutor, sessionKey, capability } = await buildFixture();
    const request = buildOnChainMoneyRequest({ amountWei: 250_000_000_000_000n });
    broadcastTransactionMock.mockReset().mockRejectedValue(new Error('nonce too low'));

    const { OnChainBroadcastError } = await import('../onChainExecutor.js');
    const executor = createEthersOnChainExecutor(() => sessionKey);

    await expect(executor.send(request, capability)).rejects.toThrow(OnChainBroadcastError);
    await expect(executor.send(request, capability)).rejects.toThrow(/nonce too low/);
  });

  it('surfaces an insufficient-funds broadcast rejection as a typed InsufficientBalanceError', async () => {
    const { createEthersOnChainExecutor, sessionKey, capability } = await buildFixture();
    const request = buildOnChainMoneyRequest();
    broadcastTransactionMock
      .mockReset()
      .mockRejectedValue(Object.assign(new Error('insufficient funds for gas * price + value'), {
        code: 'INSUFFICIENT_FUNDS',
      }));

    const { InsufficientBalanceError } = await import('../onChainExecutor.js');
    const executor = createEthersOnChainExecutor(() => sessionKey);

    await expect(executor.send(request, capability)).rejects.toThrow(InsufficientBalanceError);
  });
});
