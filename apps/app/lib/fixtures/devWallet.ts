import type { FunderWallet, SessionCapabilityScope } from '@noisebound/pqc-wallet';

/**
 * DEVELOPMENT FIXTURE â€” stands in for a real funding/paymaster integration.
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

/** Gas top-up sent to every newly issued session key in the dev fixture, on top of any scope-based funding. */
export const DEV_SESSION_GAS_BUFFER_WEI = 30_000_000_000_000n; // ~0.00003 ETH -- Base Sepolia gas is near-zero; this is a gas top-up, not a spend amount

/**
 * Ceiling on how much of a scope's maxSpendWei the dev fixture will actually
 * pre-fund. A session key issued with a huge scope (e.g. 1 ETH) is still
 * only ever going to spend what the dev funder wallet can plausibly carry
 * on a testnet, so we cap the pre-funded amount rather than transferring
 * the full scope -- that would drain the shared dev funder for scopes that
 * may never be fully spent.
 */
export const DEV_SESSION_MAX_SCOPE_FUNDING_WEI = 10_000_000_000_000_000n; // 0.01 ETH

/**
 * Computes how much native token to send a freshly issued session key in the
 * dev fixture: a small fixed gas buffer plus enough of the scope's
 * maxSpendWei (capped at {@link DEV_SESSION_MAX_SCOPE_FUNDING_WEI}) for the
 * key to actually be able to execute an authorized transaction, instead of
 * always sending a fixed gas-only amount regardless of scope.
 */
export function computeDevSessionFundingWei(scope: SessionCapabilityScope): bigint {
  const requestedSpend = BigInt(scope.maxSpendWei);
  const scopeFunding =
    requestedSpend < DEV_SESSION_MAX_SCOPE_FUNDING_WEI
      ? requestedSpend
      : DEV_SESSION_MAX_SCOPE_FUNDING_WEI;
  return DEV_SESSION_GAS_BUFFER_WEI + scopeFunding;
}

