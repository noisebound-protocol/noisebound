import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('node-fetch', () => ({
  default: vi.fn().mockRejectedValue(new Error('network disabled in tests')),
}));

import { DeFiReasoner } from '../src/reasoning/DeFiReasoner.js';
import { AaveFetcher } from '../src/reasoning/protocols/AaveFetcher.js';
import { UniswapFetcher } from '../src/reasoning/protocols/UniswapFetcher.js';
import { AerodromeFetcher } from '../src/reasoning/protocols/AerodromeFetcher.js';
import { GasFetcher } from '../src/reasoning/protocols/GasFetcher.js';
import type { ParsedIntent, UserContext } from '../src/parser/types.js';

afterEach(() => {
  vi.restoreAllMocks();
});

function intent(action: ParsedIntent['action'], params: ParsedIntent['params'] = {}, raw = ''): ParsedIntent {
  return {
    action,
    confidence: 0.8,
    params,
    requiresReasoning: true,
    raw,
    ghostResponse: `Understood, Sovereign.`,
  };
}

function context(balances: Record<string, string>): UserContext {
  return { address: '0xUSER', network: 'base-sepolia', balances };
}

describe('DeFiReasoner — borrow', () => {
  it('respects an interest rate constraint that the fallback rates satisfy', async () => {
    const reasoner = new DeFiReasoner();
    const plan = await reasoner.reason(
      intent('borrow', { fromToken: 'ETH', constraint: 'no more than 8% interest' }),
      context({ ETH: '5' }),
    );
    expect(plan.warnings.some(w => /constraint/i.test(w))).toBe(false);
    expect(plan.reasoning.some(r => r.includes('passes constraint'))).toBe(true);
  });

  it('warns when no Aave rate satisfies the constraint', async () => {
    const reasoner = new DeFiReasoner();
    const plan = await reasoner.reason(
      intent('borrow', { fromToken: 'ETH', constraint: 'no more than 1% interest' }),
      context({ ETH: '5' }),
    );
    expect(plan.warnings.some(w => /constraint/i.test(w))).toBe(true);
    expect(plan.confidence).toBeLessThan(0.5);
  });

  it('keeps health factor above 1.5', async () => {
    const reasoner = new DeFiReasoner();
    const plan = await reasoner.reason(intent('borrow', { fromToken: 'ETH' }), context({ ETH: '10' }));
    const hfLine = plan.reasoning.find(r => r.includes('Health factor'));
    const hf = parseFloat(hfLine!.match(/([\d.]+)/)![1]);
    expect(hf).toBeGreaterThan(1.5);
  });

  it('applies an 80% safety buffer to the theoretical max borrow', async () => {
    const reasoner = new DeFiReasoner();
    // Fallback: ETH LTV 0.8, price $3000 → 5 ETH = $15000, theoretical max $12000, safe = $9600
    const plan = await reasoner.reason(intent('borrow', { fromToken: 'ETH' }), context({ ETH: '5' }));
    const borrowStep = plan.steps.find(s => s.action === 'borrow');
    expect(borrowStep?.params.borrowUsd).toBe('9600.00');
  });

  it('falls back to USDC parameters for an unknown collateral token', async () => {
    const reasoner = new DeFiReasoner();
    const plan = await reasoner.reason(intent('borrow', { fromToken: 'CBETH' }), context({ CBETH: '2' }));
    expect(plan.steps.length).toBeGreaterThan(0);
    expect(plan.confidence).toBeGreaterThan(0);
  });
});

describe('DeFiReasoner — swap', () => {
  it('warns when price impact exceeds 1%', async () => {
    vi.spyOn(UniswapFetcher.prototype, 'getQuote').mockResolvedValue({
      amountOut: '990', priceImpact: 0.02, route: ['ETH', 'USDC'],
    });
    const reasoner = new DeFiReasoner();
    const plan = await reasoner.reason(
      intent('swap', { fromToken: 'ETH', toToken: 'USDC', amount: '1' }),
      context({ ETH: '5' }),
    );
    expect(plan.warnings.some(w => /price impact/i.test(w))).toBe(true);
  });

  it('warns on insufficient balance and lowers confidence', async () => {
    const reasoner = new DeFiReasoner();
    const plan = await reasoner.reason(
      intent('swap', { fromToken: 'ETH', toToken: 'USDC', amount: '100' }),
      context({ ETH: '1' }),
    );
    expect(plan.warnings.some(w => /insufficient/i.test(w))).toBe(true);
    expect(plan.confidence).toBeLessThan(0.5);
  });

  it('warns when slippage tolerance is exceeded', async () => {
    vi.spyOn(UniswapFetcher.prototype, 'getQuote').mockResolvedValue({
      amountOut: '990', priceImpact: 0.02, route: ['ETH', 'USDC'],
    });
    const reasoner = new DeFiReasoner();
    const plan = await reasoner.reason(
      intent('swap', { fromToken: 'ETH', toToken: 'USDC', amount: '1', slippage: 0.001 }),
      context({ ETH: '5' }),
    );
    expect(plan.warnings.some(w => /slippage/i.test(w))).toBe(true);
  });

  it('includes an approve step for non-ETH tokens', async () => {
    const reasoner = new DeFiReasoner();
    const plan = await reasoner.reason(
      intent('swap', { fromToken: 'USDC', toToken: 'ETH', amount: '100' }),
      context({ USDC: '1000' }),
    );
    expect(plan.steps[0].action).toBe('approve');
  });
});

describe('DeFiReasoner — earn', () => {
  it('recommends the higher-APY option when no risk preference is stated', async () => {
    vi.spyOn(AerodromeFetcher.prototype, 'getBestYield').mockResolvedValue({
      poolAddress: '0xpool', token0: 'USDC', token1: 'AERO', apr: 0.15, tvl: 1_000_000, fee: 0.003,
    });
    const reasoner = new DeFiReasoner();
    const plan = await reasoner.reason(intent('earn', { fromToken: 'USDC' }), context({ USDC: '1000' }));
    expect(plan.steps[0].protocol).toBe('aerodrome');
    expect(plan.warnings.some(w => /no risk preference/i.test(w))).toBe(true);
  });

  it('prefers Aave when the user states a low-risk preference', async () => {
    vi.spyOn(AerodromeFetcher.prototype, 'getBestYield').mockResolvedValue({
      poolAddress: '0xpool', token0: 'USDC', token1: 'AERO', apr: 0.15, tvl: 1_000_000, fee: 0.003,
    });
    const reasoner = new DeFiReasoner();
    const plan = await reasoner.reason(
      intent('earn', { fromToken: 'USDC' }, 'find me the safest, low risk yield on my USDC'),
      context({ USDC: '1000' }),
    );
    expect(plan.steps[0].protocol).toBe('aave');
  });

  it('returns an empty plan with a clarifying warning when no yield data is available', async () => {
    vi.spyOn(AaveFetcher.prototype, 'getRates').mockResolvedValue(undefined as never);
    vi.spyOn(AerodromeFetcher.prototype, 'getBestYield').mockResolvedValue(null);
    const reasoner = new DeFiReasoner();
    const plan = await reasoner.reason(intent('earn', { fromToken: 'WELL' }), context({ WELL: '100' }));
    expect(plan.steps).toHaveLength(0);
    expect(plan.warnings.length).toBeGreaterThan(0);
  });
});

describe('DeFiReasoner — rebalance', () => {
  it('calculates correct buy/sell amounts toward target allocation', async () => {
    const reasoner = new DeFiReasoner();
    const plan = await reasoner.reason(
      intent('complex', {}, 'rebalance my portfolio to 50% ETH and 50% USDC'),
      context({ ETH: '2', USDC: '0' }),
    );
    // 2 ETH @ $3000 = $6000 total; target is $3000/$3000 → sell ~$3000 ETH, buy ~$3000 USDC
    const sell = plan.steps.find(s => s.action === 'sell');
    const buy = plan.steps.find(s => s.action === 'buy');
    expect(sell?.params.token).toBe('ETH');
    expect(parseFloat(sell!.params.usdAmount)).toBeCloseTo(3000, 0);
    expect(buy?.params.token).toBe('USDC');
    expect(parseFloat(buy!.params.usdAmount)).toBeCloseTo(3000, 0);
  });

  it('asks for clarification when no allocation targets are found', async () => {
    const reasoner = new DeFiReasoner();
    const plan = await reasoner.reason(intent('complex', {}, 'rebalance my portfolio'), context({ ETH: '2' }));
    expect(plan.steps).toHaveLength(0);
    expect(plan.warnings.some(w => /target allocation/i.test(w))).toBe(true);
  });
});

describe('DeFiReasoner — general invariants', () => {
  it('returns plans with all required ExecutionPlan fields', async () => {
    const reasoner = new DeFiReasoner();
    const plan = await reasoner.reason(intent('borrow', { fromToken: 'ETH' }), context({ ETH: '5' }));
    for (const key of ['steps', 'estimatedGas', 'estimatedOutcome', 'riskLevel', 'warnings', 'reasoning', 'requiresApproval', 'totalFees', 'confidence']) {
      expect(plan).toHaveProperty(key);
    }
  });

  it('produces a non-empty reasoning trace for complex intents', async () => {
    const reasoner = new DeFiReasoner();
    const plan = await reasoner.reason(intent('complex', { protocol: 'uniswap' }, 'swap on uniswap only if gas is cheap'), context({ ETH: '1' }));
    expect(plan.reasoning.length).toBeGreaterThan(0);
  });

  it('falls back gracefully when AaveFetcher hits a network error', async () => {
    const fetcher = new AaveFetcher();
    const rates = await fetcher.getRates('base-sepolia');
    expect(rates.ETH.ltv).toBe(0.8);
    expect(rates.USDC.ltv).toBe(0.77);
  });

  it('falls back gracefully when GasFetcher hits a network error', async () => {
    const fetcher = new GasFetcher();
    const price = await fetcher.getGasPrice('base-sepolia');
    expect(price).toBe('0.05');
  });

  it('falls back gracefully when AerodromeFetcher hits a network error', async () => {
    const fetcher = new AerodromeFetcher();
    const pools = await fetcher.getPools('base-sepolia');
    expect(pools.length).toBeGreaterThan(0);
  });

  it('falls back gracefully when UniswapFetcher and its CoinGecko fallback both fail', async () => {
    const fetcher = new UniswapFetcher();
    const quote = await fetcher.getQuote('ETH', 'USDC', '1', 'base-sepolia');
    expect(quote.estimated).toBe(true);
  });

  it('calculateMaxBorrow applies the safety buffer correctly', async () => {
    const fetcher = new AaveFetcher();
    const rates = await fetcher.getRates('base-sepolia');
    const safeBorrow = fetcher.calculateMaxBorrow(10000, 'ETH', rates, 0.8);
    expect(safeBorrow).toBeCloseTo(10000 * 0.8 * 0.8, 5);
  });

  it('builds a generic plan for actions without a specialized reasoning path', async () => {
    const reasoner = new DeFiReasoner();
    const plan = await reasoner.reason(intent('repay', {}), context({ USDC: '500' }));
    expect(plan.steps).toHaveLength(1);
    expect(plan.confidence).toBe(0.5);
  });
});
