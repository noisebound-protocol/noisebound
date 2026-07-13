export interface AaveTokenRates {
  supplyAPY: number;
  variableBorrowAPY: number;
  stableBorrowAPY: number;
  /** Loan-to-value ratio, 0-1 */
  ltv: number;
}

export interface AaveData {
  rates: {
    USDC: AaveTokenRates;
    ETH: AaveTokenRates;
    WBTC: AaveTokenRates;
  };
  stale?: boolean;
  userPosition?: {
    collateral: Record<string, string>;
    debt: Record<string, string>;
    healthFactor: number;
  };
}

export interface UniswapQuote {
  amountOut: string;
  priceImpact: number;
  route: string[];
  estimated?: boolean;
}

export interface AerodromePool {
  poolAddress: string;
  token0: string;
  token1: string;
  apr: number;
  tvl: number;
  fee: number;
}

export interface UniswapData {
  lastQuote?: UniswapQuote;
}

export interface AerodromeData {
  pools?: AerodromePool[];
}

export interface DeFiContext {
  balances: Record<string, string>;
  network: 'base' | 'base-sepolia';
  address: string;
  gasPrice?: string;
  protocols: {
    aave?: AaveData;
    uniswap?: UniswapData;
    aerodrome?: AerodromeData;
  };
}

export interface ExecutionStep {
  index: number;
  protocol: string;
  action: string;
  description: string;
  params: Record<string, string>;
  estimatedGas: string;
  requiresApproval?: boolean;
  calldata?: string;
}

export interface ExecutionPlan {
  steps: ExecutionStep[];
  estimatedGas: string;
  estimatedOutcome: string;
  riskLevel: 'low' | 'medium' | 'high';
  warnings: string[];
  /** Full chain-of-thought trace */
  reasoning: string[];
  requiresApproval: boolean;
  totalFees: string;
  confidence: number;
}
