import { Wallet } from 'ethers';
import type { SessionKey } from './types.js';

/** Generates a fresh random ephemeral secp256k1 session key. Never deterministically derived. */
export function generateSessionKey(): SessionKey {
  const wallet = Wallet.createRandom();
  return {
    address: wallet.address as `0x${string}`,
    publicKey: wallet.publicKey,
    privateKey: wallet.privateKey as `0x${string}`,
  };
}
