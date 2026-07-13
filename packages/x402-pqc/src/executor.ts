import type { ethers } from 'ethers';
import { getActiveNetwork } from '@noisebound/pqc-wallet';
import type { CapabilityToken } from './types.js';
import type { RevocationRegistry } from './revocation.js';
import { verifyCapabilityToken } from './verify-capability.js';

/**
 * The only sanctioned path from a capability token to an on-chain broadcast.
 * Verifies the execution signer matches the token's authorized address, that
 * the signer is actually connected to the active network (never assume — a
 * misconfigured signer could otherwise broadcast to the wrong chain, e.g.
 * mainnet when the app believes it's on testnet), and that the token grants
 * a sign-tx scope covering this exact transaction. Only then does it send.
 * Throws on any failure — callers must not fall back to a raw signer call.
 */
export async function executeScopedTransaction(
  token: CapabilityToken,
  executionSigner: ethers.Signer,
  tx: ethers.TransactionRequest,
  registry: RevocationRegistry,
): Promise<ethers.TransactionResponse> {
  const signerAddress = await executionSigner.getAddress();
  if (signerAddress.toLowerCase() !== token.executionAddress.toLowerCase()) {
    throw new Error('execution signer does not match token.executionAddress');
  }

  const amountWei = (tx.value ?? 0n).toString();
  const contractAddress = typeof tx.to === 'string' ? tx.to : undefined;

  const result = verifyCapabilityToken(
    token,
    { type: 'sign-tx', maxAmountWei: amountWei, contractAddress },
    registry,
  );

  if (!result.valid) {
    throw new Error(`capability check failed: ${result.error}`);
  }

  const activeNetwork = getActiveNetwork();
  const connectedNetwork = await executionSigner.provider?.getNetwork();
  if (!connectedNetwork || Number(connectedNetwork.chainId) !== activeNetwork.chainId) {
    throw new Error(
      `execution signer is not connected to the active network (${activeNetwork.displayName}, chainId ${activeNetwork.chainId})`,
    );
  }

  return executionSigner.sendTransaction(tx);
}