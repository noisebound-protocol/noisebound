import type { FunderWallet } from '@noisebound/pqc-wallet';

/**
 * DEVELOPMENT FIXTURE — stands in for a real funding/paymaster integration.
 * The key below is Hardhat's well-known account #0 test key: public,
 * intentionally unfunded on real networks, safe to commit. This entire
 * module is placeholder infrastructure for local development; a real
 * funding source (or a browser extension wallet connection) is future work.
 */
export function getDevFunderWallet(): FunderWallet {
  const privateKey = process.env.NOISEBOUND_DEV_FUNDER_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('NOISEBOUND_DEV_FUNDER_PRIVATE_KEY is not set');
  }
  return { privateKey: privateKey as `0x${string}` };
}

/** Gas top-up sent to every newly issued session key in the dev fixture. */
export const DEV_SESSION_FUNDING_WEI = 2_000_000_000_000_000n;
