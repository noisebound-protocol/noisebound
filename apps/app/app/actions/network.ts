'use server';

import 'server-only';
import { getActiveNetwork } from '@noisebound/networks';
import { fetchERC20Balance, fetchNativeBalance } from '@noisebound/pqc-wallet';

export interface BalancesResult {
  readonly nativeWei: string;
  readonly usdcRaw: string;
}

/** Fetches native + USDC balances for an address on the currently active network. */
export async function getBalancesAction(address: string): Promise<BalancesResult> {
  const network = getActiveNetwork();
  const [nativeWei, usdcRaw] = await Promise.all([
    fetchNativeBalance(address),
    fetchERC20Balance(address, network.usdcAddress),
  ]);

  return { nativeWei: nativeWei.toString(), usdcRaw: usdcRaw.toString() };
}
