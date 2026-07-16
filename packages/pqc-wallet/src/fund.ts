import { JsonRpcProvider, Wallet } from 'ethers';
import { getActiveNetwork } from '@noisebound/networks';
import { issueSessionCapability } from './capability.js';
import type { IdentityKeyPair } from '@noisebound/identity';
import type {
  FunderWallet,
  IssueAndFundResult,
  SessionCapabilityScope,
} from './types.js';

/**
 * Raised when a real on-chain funding transfer fails (insufficient funder
 * balance, RPC/network failure, etc.), so callers never mistake a broadcast
 * failure for a silently-skipped transfer.
 */
export class SessionFundingError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'SessionFundingError';
  }
}

/**
 * Sends a REAL on-chain native-token transfer from `funderWallet` to
 * `sessionAddress`, unlike the other (pure-signing, offline) functions in
 * this package. Used to gas-fund a freshly generated session key so it can
 * broadcast its own first transaction. Returns the funding transaction hash.
 *
 * @throws {SessionFundingError} if the RPC call fails (e.g. insufficient
 *   funder balance or a network error).
 */
export async function fundSessionKey(
  funderWallet: FunderWallet,
  sessionAddress: `0x${string}`,
  amountWei: bigint,
): Promise<`0x${string}`> {
  const network = getActiveNetwork();
  const provider = new JsonRpcProvider(network.rpcUrl, network.chainId);
  const wallet = new Wallet(funderWallet.privateKey, provider);

  try {
    const tx = await wallet.sendTransaction({ to: sessionAddress, value: amountWei });
    return tx.hash as `0x${string}`;
  } catch (error) {
    throw new SessionFundingError(
      `Failed to fund session key ${sessionAddress}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { cause: error },
    );
  }
}

/**
 * Composes {@link issueSessionCapability} with {@link fundSessionKey}: issues
 * the capability, then immediately broadcasts a REAL on-chain transaction to
 * gas-fund the new session address, since these two steps almost always
 * happen together in practice.
 *
 * @throws {SessionFundingError} if the funding transaction fails; the
 *   capability is still issued (and discarded) in that case, since capability
 *   issuance itself cannot fail.
 */
export async function issueAndFundSessionCapability(
  identityKeyPair: IdentityKeyPair,
  sessionPublicKey: string,
  scope: SessionCapabilityScope,
  ttlMs: number,
  funderWallet: FunderWallet,
  amountWei: bigint,
): Promise<IssueAndFundResult> {
  const capability = issueSessionCapability(identityKeyPair, sessionPublicKey, scope, ttlMs);
  const fundingTxHash = await fundSessionKey(
    funderWallet,
    capability.payload.sessionAddress,
    amountWei,
  );

  return { capability, fundingTxHash };
}
