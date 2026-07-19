import { Wallet } from 'ethers';
import { fetchNativeBalance } from '@noisebound/pqc-wallet';
import type { CheckDefinition } from '@noisebound/observe-loop';
import { getDevFunderWallet } from '../fixtures/devWallet';

export const FUNDER_BALANCE_CHECK_ID = 'dev-funder-native-balance';

/** Below this, the funder wallet can no longer gas-fund a newly issued session key. */
const LOW_BALANCE_THRESHOLD_WEI = 1_000_000_000_000_000n; // 0.001 native token

const CHECK_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Watches the dev funder wallet's native-token balance so a drained funder
 * (which silently breaks new session-key issuance) shows up as a tier-1
 * notification — inaction (not topping up gas) directly costs money — rather
 * than being discovered only when the next issuance attempt fails.
 */
export function createFunderBalanceCheck(): CheckDefinition<string> {
  return {
    id: FUNDER_BALANCE_CHECK_ID,
    description: 'Dev funder wallet native balance',
    checkIntervalMs: CHECK_INTERVAL_MS,
    initialValue: '0',
    run: async () => {
      const { privateKey } = getDevFunderWallet();
      const address = new Wallet(privateKey).address;
      const balanceWei = await fetchNativeBalance(address);
      return balanceWei.toString();
    },
    onResult: (previous, next) => {
      const previousWei = BigInt(previous);
      const nextWei = BigInt(next);
      const crossedLow = previousWei >= LOW_BALANCE_THRESHOLD_WEI && nextWei < LOW_BALANCE_THRESHOLD_WEI;
      if (!crossedLow) return undefined;
      return { id: `${FUNDER_BALANCE_CHECK_ID}-low`, kind: 'inaction-costs-money' };
    },
  };
}
