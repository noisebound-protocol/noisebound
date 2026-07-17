import { JsonRpcProvider, Wallet } from 'ethers';
import type { TransactionRequest } from 'ethers';
import { getActiveNetwork } from '@noisebound/networks';
import type { SessionKey } from '@noisebound/pqc-wallet';
import type { OnChainExecutor, OnChainMoneyActionRequest } from './types.js';

/** Resolves the ephemeral secp256k1 session key backing a capability's session address. */
export type SessionKeyResolver = (sessionAddress: `0x${string}`) => SessionKey | undefined;

/** Raised when no session key is registered for the capability's session address. */
export class SessionKeyNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionKeyNotFoundError';
  }
}

/** Raised when signing the transaction with the session key fails. */
export class SessionSigningError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'SessionSigningError';
  }
}

/** Raised when the session key cannot cover the transfer amount plus estimated gas. */
export class InsufficientBalanceError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'InsufficientBalanceError';
  }
}

/** Raised when reading account state from, or broadcasting to, the active network's RPC fails. */
export class OnChainBroadcastError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'OnChainBroadcastError';
  }
}

const NATIVE_TRANSFER_GAS_LIMIT = 21_000n;

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isInsufficientFundsError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 'INSUFFICIENT_FUNDS' || /insufficient funds/i.test(describeError(error));
}

/**
 * Builds an {@link OnChainExecutor} that signs and broadcasts a real native-token
 * transfer on the currently active network (see @noisebound/networks), using the
 * ephemeral secp256k1 session key resolved for the confirmed capability.
 *
 * Signing (`Wallet.signTransaction`) is always performed locally against the
 * session key and never touches the network; only account-state lookups
 * (nonce, fee data, balance) and the final broadcast go through the RPC
 * provider, so an RPC outage cannot be mistaken for a signing failure.
 */
export function createEthersOnChainExecutor(resolveSessionKey: SessionKeyResolver): OnChainExecutor {
  return {
    async send(request: OnChainMoneyActionRequest, sessionCapability) {
      const sessionAddress = sessionCapability.payload.sessionAddress;
      const sessionKey = resolveSessionKey(sessionAddress);

      if (sessionKey === undefined) {
        throw new SessionKeyNotFoundError(
          `No session key is registered for session address ${sessionAddress}`,
        );
      }

      if (sessionKey.address !== sessionAddress) {
        throw new SessionKeyNotFoundError(
          `Resolved session key address ${sessionKey.address} does not match the capability's session address ${sessionAddress}`,
        );
      }

      const network = getActiveNetwork();
      const provider = new JsonRpcProvider(network.rpcUrl, network.chainId);
      const wallet = new Wallet(sessionKey.privateKey);

      let nonce: number;
      let maxFeePerGas: bigint;
      let maxPriorityFeePerGas: bigint;
      let balance: bigint;
      try {
        const [fetchedNonce, feeData, fetchedBalance] = await Promise.all([
          provider.getTransactionCount(sessionAddress, 'pending'),
          provider.getFeeData(),
          provider.getBalance(sessionAddress),
        ]);
        if (feeData.maxFeePerGas === null) {
          throw new Error('RPC did not return EIP-1559 fee data (maxFeePerGas is null)');
        }
        nonce = fetchedNonce;
        maxFeePerGas = feeData.maxFeePerGas;
        maxPriorityFeePerGas = feeData.maxPriorityFeePerGas ?? feeData.maxFeePerGas;
        balance = fetchedBalance;
      } catch (error) {
        throw new OnChainBroadcastError(
          `Failed to read account state from RPC: ${describeError(error)}`,
          { cause: error },
        );
      }

      const estimatedFee = maxFeePerGas * NATIVE_TRANSFER_GAS_LIMIT;
      if (balance < request.amountWei + estimatedFee) {
        throw new InsufficientBalanceError(
          `Session key ${sessionAddress} has insufficient balance: has ${balance.toString()} wei, needs at least ${(request.amountWei + estimatedFee).toString()} wei (amount + estimated gas)`,
        );
      }

      const txRequest: TransactionRequest = {
        type: 2,
        chainId: network.chainId,
        to: request.recipient,
        value: request.amountWei,
        nonce,
        gasLimit: NATIVE_TRANSFER_GAS_LIMIT,
        maxFeePerGas,
        maxPriorityFeePerGas,
      };

      let signedTx: string;
      try {
        signedTx = await wallet.signTransaction(txRequest);
      } catch (error) {
        throw new SessionSigningError(
          `Failed to sign transaction with session key ${sessionAddress}: ${describeError(error)}`,
          { cause: error },
        );
      }

      try {
        const txResponse = await provider.broadcastTransaction(signedTx);
        return txResponse.hash as `0x${string}`;
      } catch (error) {
        if (isInsufficientFundsError(error)) {
          throw new InsufficientBalanceError(
            `Broadcast rejected for insufficient funds: ${describeError(error)}`,
            { cause: error },
          );
        }
        throw new OnChainBroadcastError(
          `Failed to broadcast transaction: ${describeError(error)}`,
          { cause: error },
        );
      }
    },
  };
}
