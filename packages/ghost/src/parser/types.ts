export type GhostAction =
  | 'swap'
  | 'send'
  | 'earn'
  | 'stake'
  | 'borrow'
  | 'repay'
  | 'provide_liquidity'
  | 'remove_liquidity'
  | 'bridge'
  | 'approve'
  | 'query'
  | 'complex'
  | 'clarify';

export interface ParsedIntentParams {
  fromToken?: string;
  toToken?: string;
  amount?: string;
  amountIsPercent?: boolean;
  recipient?: string;
  protocol?: string;
  /** Free-text constraint, e.g. "no more than 10% interest" */
  constraint?: string;
  timeframe?: string;
  slippage?: number;
  maxGas?: string;
  queryType?: 'balance' | 'history' | 'price';
}

export interface ParsedIntent {
  action: GhostAction;
  /** Model/rule confidence, 0-1 */
  confidence: number;
  params: ParsedIntentParams;
  requiresReasoning: boolean;
  raw: string;
  /** Human-readable Ghost response, always addresses the user as Sovereign */
  ghostResponse: string;
}

export interface UserContext {
  address: string;
  network: 'base' | 'base-sepolia';
  balances: Record<string, string>;
  recentActions?: string[];
}
