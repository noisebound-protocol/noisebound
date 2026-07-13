import type { ParsedIntent, UserContext } from '../parser/types.js';
import type { DeFiContext, ExecutionPlan, ExecutionStep, AaveData } from './types.js';
import { AaveFetcher } from './protocols/AaveFetcher.js';
import { UniswapFetcher } from './protocols/UniswapFetcher.js';
import { AerodromeFetcher } from './protocols/AerodromeFetcher.js';
import { GasFetcher } from './protocols/GasFetcher.js';

/** Rough USD price table used for portfolio-value heuristics (mock — not a price oracle). */
const TOKEN_USD_PRICE: Record<string, number> = {
  USDC: 1, USDT: 1, DAI: 1,
  ETH: 3000, WETH: 3000,
  WBTC: 60000, CBBTC: 60000,
  OCT: 0.5, AERO: 1.2,
};

function priceOf(token: string): number {
  return TOKEN_USD_PRICE[token.toUpperCase()] ?? 1;
}

export class DeFiReasoner {
  private aave = new AaveFetcher();
  private uniswap = new UniswapFetcher();
  private aerodrome = new AerodromeFetcher();
  private gas = new GasFetcher();

  async reason(intent: ParsedIntent, context: UserContext): Promise<ExecutionPlan> {
    const defiCtx = await this.fetchDeFiContext(context);

    switch (intent.action) {
      case 'borrow':
        return this.reasonBorrow(intent, context, defiCtx);
      case 'swap':
        return this.reasonSwap(intent, context, defiCtx);
      case 'earn':
        return this.reasonEarn(intent, context, defiCtx);
      case 'complex':
        return /rebalance|allocat/i.test(intent.raw)
          ? this.reasonRebalance(intent, context, defiCtx)
          : this.reasonDefault(intent, context, defiCtx);
      default:
        return this.reasonDefault(intent, context, defiCtx);
    }
  }

  // ─── Borrow ─────────────────────────────────────────────────────────────

  private async reasonBorrow(
    intent: ParsedIntent,
    context: UserContext,
    defiCtx: DeFiContext,
  ): Promise<ExecutionPlan> {
    const reasoning: string[] = [];
    const warnings: string[] = [];

    const token = (intent.params.fromToken ?? Object.keys(context.balances)[0] ?? 'USDC').toUpperCase();
    const balance = parseFloat(context.balances[token] ?? '0');
    const collateralAmount =
      intent.params.amount && !intent.params.amountIsPercent
        ? parseFloat(intent.params.amount)
        : intent.params.amountIsPercent
          ? balance * (parseFloat(intent.params.amount ?? '100') / 100)
          : balance;
    const usdValue = collateralAmount * priceOf(token);
    reasoning.push(`Checking ${token} balance: ${collateralAmount} = $${usdValue.toFixed(2)}`);

    const rates = defiCtx.protocols.aave?.rates;
    reasoning.push(`Fetching Aave V3 ${token} parameters on Base`);

    const tokenRates = (rates as Record<string, AaveData['rates']['USDC']> | undefined)?.[token];
    const ltv = tokenRates?.ltv ?? rates?.USDC.ltv ?? 0.75;
    const theoreticalMax = usdValue * ltv;
    reasoning.push(`${token} LTV: ${(ltv * 100).toFixed(0)}% → theoretical max borrow = $${theoreticalMax.toFixed(2)}`);

    const safetyBuffer = 0.8;
    const safeBorrow = theoreticalMax * safetyBuffer;
    reasoning.push(`Applying ${(safetyBuffer * 100).toFixed(0)}% safety buffer → safe borrow = $${safeBorrow.toFixed(2)}`);

    let constraintPct: number | undefined;
    if (intent.params.constraint) {
      reasoning.push(`Constraint check: ${intent.params.constraint}`);
      const pctMatch = intent.params.constraint.match(/(\d+(?:\.\d+)?)\s*%/);
      if (pctMatch) constraintPct = parseFloat(pctMatch[1]);
    }

    const variableRate = (tokenRates?.variableBorrowAPY ?? rates?.USDC.variableBorrowAPY ?? 0.05) * 100;
    const stableRate = (tokenRates?.stableBorrowAPY ?? rates?.USDC.stableBorrowAPY ?? 0.06) * 100;
    const variablePasses = constraintPct === undefined || variableRate <= constraintPct;
    const stablePasses = constraintPct === undefined || stableRate <= constraintPct;
    reasoning.push(`Current variable rate: ${variableRate.toFixed(2)}% ${variablePasses ? 'passes constraint' : 'fails constraint'}`);
    reasoning.push(`Current stable rate: ${stableRate.toFixed(2)}% ${stablePasses ? 'passes constraint' : 'fails constraint'}`);

    if (constraintPct !== undefined && !variablePasses && !stablePasses) {
      warnings.push(`No Aave rate for ${token} satisfies the constraint "${intent.params.constraint}"`);
    }

    // Heuristic health factor: liquidation threshold normalized to 1.0, see module docs.
    const healthFactor = 1 / (ltv * safetyBuffer);
    reasoning.push(`Health factor at safe borrow: ${healthFactor.toFixed(2)} (target > 1.5)`);
    if (healthFactor < 2.0) {
      warnings.push(`Health factor (${healthFactor.toFixed(2)}) is below 2.0 — consider borrowing less for extra safety margin.`);
    }

    reasoning.push('Building Aave supply + borrow sequence');

    const steps: ExecutionStep[] = [
      {
        index: 0,
        protocol: 'aave',
        action: 'approve',
        description: `Approve Aave V3 to spend ${collateralAmount} ${token}`,
        params: { token, amount: collateralAmount.toString() },
        estimatedGas: await this.gas.estimateGasCost(1, context.network),
        requiresApproval: true,
      },
      {
        index: 1,
        protocol: 'aave',
        action: 'supply',
        description: `Supply ${collateralAmount} ${token} as collateral`,
        params: { token, amount: collateralAmount.toString() },
        estimatedGas: await this.gas.estimateGasCost(1, context.network),
      },
      {
        index: 2,
        protocol: 'aave',
        action: 'borrow',
        description: `Borrow $${safeBorrow.toFixed(2)} against ${token} collateral`,
        params: { collateralToken: token, borrowUsd: safeBorrow.toFixed(2), rateMode: variablePasses ? 'variable' : 'stable' },
        estimatedGas: await this.gas.estimateGasCost(1, context.network),
      },
    ];

    return {
      steps,
      estimatedGas: await this.gas.estimateGasCost(steps.length, context.network),
      estimatedOutcome: `Borrow up to $${safeBorrow.toFixed(2)} against ${collateralAmount} ${token} while keeping health factor at ${healthFactor.toFixed(2)}`,
      riskLevel: healthFactor < 1.8 ? 'high' : healthFactor < 2.5 ? 'medium' : 'low',
      warnings,
      reasoning,
      requiresApproval: true,
      totalFees: '0.00',
      confidence: constraintPct !== undefined && !variablePasses && !stablePasses ? 0.4 : 0.85,
    };
  }

  // ─── Swap ───────────────────────────────────────────────────────────────

  private async reasonSwap(
    intent: ParsedIntent,
    context: UserContext,
    defiCtx: DeFiContext,
  ): Promise<ExecutionPlan> {
    const reasoning: string[] = [];
    const warnings: string[] = [];

    const fromToken = (intent.params.fromToken ?? Object.keys(context.balances)[0] ?? 'USDC').toUpperCase();
    const toToken = (intent.params.toToken ?? 'USDC').toUpperCase();
    const balance = parseFloat(context.balances[fromToken] ?? '0');
    const amount =
      intent.params.amount && intent.params.amountIsPercent
        ? balance * (parseFloat(intent.params.amount) / 100)
        : parseFloat(intent.params.amount ?? balance.toString());

    reasoning.push(`Verifying ${fromToken} balance: have ${balance}, need ${amount}`);
    if (amount > balance) {
      warnings.push(`Insufficient ${fromToken} balance: requested ${amount}, available ${balance}`);
    }

    const quote = await this.uniswap.getQuote(fromToken, toToken, amount.toString(), context.network);
    reasoning.push(
      `Uniswap quote: ${amount} ${fromToken} → ${quote.amountOut} ${toToken} (price impact ${(quote.priceImpact * 100).toFixed(2)}%)${quote.estimated ? ' [ESTIMATED]' : ''}`,
    );

    if (quote.priceImpact > 0.01) {
      warnings.push(`Price impact ${(quote.priceImpact * 100).toFixed(2)}% exceeds 1% — consider splitting the trade.`);
    }

    if (intent.params.slippage !== undefined && quote.priceImpact > intent.params.slippage) {
      warnings.push(
        `Price impact ${(quote.priceImpact * 100).toFixed(2)}% exceeds your slippage tolerance of ${(intent.params.slippage * 100).toFixed(2)}%`,
      );
    }

    const steps: ExecutionStep[] = [];
    if (fromToken !== 'ETH') {
      steps.push({
        index: 0,
        protocol: 'uniswap',
        action: 'approve',
        description: `Approve Uniswap router to spend ${amount} ${fromToken}`,
        params: { token: fromToken, amount: amount.toString() },
        estimatedGas: await this.gas.estimateGasCost(1, context.network),
        requiresApproval: true,
      });
    }
    steps.push({
      index: steps.length,
      protocol: 'uniswap',
      action: 'swap',
      description: `Swap ${amount} ${fromToken} for ${toToken}`,
      params: { fromToken, toToken, amount: amount.toString(), expectedOut: quote.amountOut },
      estimatedGas: await this.gas.estimateGasCost(1, context.network),
    });
    reasoning.push('Building Uniswap swap sequence');

    return {
      steps,
      estimatedGas: await this.gas.estimateGasCost(steps.length, context.network),
      estimatedOutcome: `Receive approximately ${quote.amountOut} ${toToken}`,
      riskLevel: quote.priceImpact > 0.03 ? 'high' : quote.priceImpact > 0.01 ? 'medium' : 'low',
      warnings,
      reasoning,
      requiresApproval: fromToken !== 'ETH',
      totalFees: '0.00',
      confidence: amount > balance ? 0.3 : 0.9,
    };
  }

  // ─── Earn ───────────────────────────────────────────────────────────────

  private async reasonEarn(
    intent: ParsedIntent,
    context: UserContext,
    defiCtx: DeFiContext,
  ): Promise<ExecutionPlan> {
    const reasoning: string[] = [];
    const warnings: string[] = [];

    const token = (intent.params.fromToken ?? Object.keys(context.balances)[0] ?? 'USDC').toUpperCase();
    const balance = parseFloat(context.balances[token] ?? '0');

    const rates = defiCtx.protocols.aave?.rates;
    const aaveAPY = (rates as Record<string, AaveData['rates']['USDC']> | undefined)?.[token]?.supplyAPY ?? rates?.USDC.supplyAPY;
    reasoning.push(`Scanning Aave V3 supply APY for ${token}: ${aaveAPY !== undefined ? `${(aaveAPY * 100).toFixed(2)}%` : 'unavailable'}`);

    const bestPool = await this.aerodrome.getBestYield(token, context.network);
    reasoning.push(`Scanning Aerodrome pools for ${token}: ${bestPool ? `${(bestPool.apr * 100).toFixed(2)}% APR in ${bestPool.poolAddress}` : 'no pool found'}`);

    const hasRiskPreference = /\b(safe|low risk|conservative|no impermanent loss)\b/i.test(intent.raw);
    const hasAggressivePreference = /\b(aggressive|high yield|max yield|risk it)\b/i.test(intent.raw);

    if (aaveAPY === undefined && !bestPool) {
      return {
        steps: [],
        estimatedGas: '0.00',
        estimatedOutcome: 'No yield data available',
        riskLevel: 'low',
        warnings: ['Sovereign, no yield data is currently available for this asset.'],
        reasoning,
        requiresApproval: false,
        totalFees: '0.00',
        confidence: 0.3,
      };
    }

    if (bestPool) {
      reasoning.push(`Aerodrome LP carries impermanent loss risk on the ${bestPool.token0}/${bestPool.token1} pair`);
    }

    let chooseLp = false;
    if (bestPool && aaveAPY !== undefined) {
      if (hasRiskPreference) {
        chooseLp = false;
        reasoning.push('User requested low-risk yield → preferring Aave lending over LP');
      } else if (hasAggressivePreference || bestPool.apr > aaveAPY) {
        chooseLp = true;
        reasoning.push(`Aerodrome APR (${(bestPool.apr * 100).toFixed(2)}%) exceeds Aave APY (${(aaveAPY * 100).toFixed(2)}%) → recommending LP`);
        if (!hasRiskPreference && !hasAggressivePreference) {
          warnings.push('No risk preference stated — defaulted to the higher-yield option. Impermanent loss applies to LP positions.');
        }
      }
    } else if (bestPool && aaveAPY === undefined) {
      chooseLp = true;
    }

    const steps: ExecutionStep[] = [];
    if (chooseLp && bestPool) {
      steps.push({
        index: 0,
        protocol: 'aerodrome',
        action: 'provide_liquidity',
        description: `Provide ${balance} ${token} to ${bestPool.token0}/${bestPool.token1} pool at ${(bestPool.apr * 100).toFixed(2)}% APR`,
        params: { token, poolAddress: bestPool.poolAddress, apr: bestPool.apr.toString() },
        estimatedGas: await this.gas.estimateGasCost(1, context.network),
      });
    } else {
      steps.push({
        index: 0,
        protocol: 'aave',
        action: 'supply',
        description: `Supply ${balance} ${token} to Aave V3 at ${aaveAPY !== undefined ? (aaveAPY * 100).toFixed(2) : '?'}% APY`,
        params: { token, apy: (aaveAPY ?? 0).toString() },
        estimatedGas: await this.gas.estimateGasCost(1, context.network),
      });
    }

    return {
      steps,
      estimatedGas: await this.gas.estimateGasCost(steps.length, context.network),
      estimatedOutcome: chooseLp && bestPool
        ? `Earn ~${(bestPool.apr * 100).toFixed(2)}% APR via Aerodrome LP`
        : `Earn ~${((aaveAPY ?? 0) * 100).toFixed(2)}% APY via Aave supply`,
      riskLevel: chooseLp ? 'medium' : 'low',
      warnings,
      reasoning,
      requiresApproval: true,
      totalFees: '0.00',
      confidence: 0.8,
    };
  }

  // ─── Rebalance ──────────────────────────────────────────────────────────

  private async reasonRebalance(
    intent: ParsedIntent,
    context: UserContext,
    defiCtx: DeFiContext,
  ): Promise<ExecutionPlan> {
    const reasoning: string[] = [];
    const warnings: string[] = [];

    const targets = this.parseAllocations(intent.raw);
    reasoning.push(`Parsed target allocations: ${JSON.stringify(targets)}`);

    const currentUsd: Record<string, number> = {};
    let totalUsd = 0;
    for (const [token, amountStr] of Object.entries(context.balances)) {
      const usd = parseFloat(amountStr) * priceOf(token);
      currentUsd[token.toUpperCase()] = usd;
      totalUsd += usd;
    }
    reasoning.push(`Current portfolio value: $${totalUsd.toFixed(2)}`);

    if (Object.keys(targets).length === 0) {
      warnings.push('Sovereign, no explicit target allocation was found — please specify percentages per asset.');
      return {
        steps: [],
        estimatedGas: '0.00',
        estimatedOutcome: 'No rebalance performed — target allocation unclear',
        riskLevel: 'low',
        warnings,
        reasoning,
        requiresApproval: false,
        totalFees: '0.00',
        confidence: 0.3,
      };
    }

    const deltas: { token: string; deltaUsd: number }[] = [];
    for (const [token, fraction] of Object.entries(targets)) {
      const targetUsd = totalUsd * fraction;
      const haveUsd = currentUsd[token] ?? 0;
      deltas.push({ token, deltaUsd: targetUsd - haveUsd });
    }
    const sells = deltas.filter(d => d.deltaUsd < -0.01).sort((a, b) => a.deltaUsd - b.deltaUsd);
    const buys = deltas.filter(d => d.deltaUsd > 0.01).sort((a, b) => b.deltaUsd - a.deltaUsd);
    reasoning.push(`Sells: ${sells.map(s => `${s.token} $${Math.abs(s.deltaUsd).toFixed(2)}`).join(', ') || 'none'}`);
    reasoning.push(`Buys: ${buys.map(b => `${b.token} $${b.deltaUsd.toFixed(2)}`).join(', ') || 'none'}`);
    reasoning.push('Ordering sells before buys to minimize gas and avoid temporary undercollateralization');

    const steps: ExecutionStep[] = [];
    for (const sell of sells) {
      steps.push({
        index: steps.length,
        protocol: 'uniswap',
        action: 'sell',
        description: `Sell $${Math.abs(sell.deltaUsd).toFixed(2)} of ${sell.token} toward target allocation`,
        params: { token: sell.token, usdAmount: Math.abs(sell.deltaUsd).toFixed(2) },
        estimatedGas: await this.gas.estimateGasCost(1, context.network),
      });
    }
    for (const buy of buys) {
      steps.push({
        index: steps.length,
        protocol: 'uniswap',
        action: 'buy',
        description: `Buy $${buy.deltaUsd.toFixed(2)} of ${buy.token} toward target allocation`,
        params: { token: buy.token, usdAmount: buy.deltaUsd.toFixed(2) },
        estimatedGas: await this.gas.estimateGasCost(1, context.network),
      });
    }

    return {
      steps,
      estimatedGas: await this.gas.estimateGasCost(steps.length, context.network),
      estimatedOutcome: `Rebalance portfolio toward ${JSON.stringify(targets)}`,
      riskLevel: 'medium',
      warnings,
      reasoning,
      requiresApproval: steps.length > 0,
      totalFees: '0.00',
      confidence: 0.75,
    };
  }

  /** Parses "50% ETH, 50% USDC"-style allocation targets from free text. */
  private parseAllocations(raw: string): Record<string, number> {
    const targets: Record<string, number> = {};
    const matches = raw.matchAll(/(\d+(?:\.\d+)?)\s*%\s*(?:in\s+|of\s+)?([A-Za-z]{2,6})/gi);
    for (const m of matches) {
      targets[m[2].toUpperCase()] = parseFloat(m[1]) / 100;
    }
    return targets;
  }

  // ─── Default / generic fallback ────────────────────────────────────────

  private async reasonDefault(
    intent: ParsedIntent,
    context: UserContext,
    _defiCtx: DeFiContext,
  ): Promise<ExecutionPlan> {
    const reasoning = [
      `Action '${intent.action}' does not have a specialized reasoning path yet — building a generic plan.`,
    ];
    return {
      steps: [
        {
          index: 0,
          protocol: intent.params.protocol ?? 'unknown',
          action: intent.action,
          description: `Execute ${intent.action} as requested`,
          params: Object.fromEntries(
            Object.entries(intent.params).map(([k, v]) => [k, String(v)]),
          ),
          estimatedGas: await this.gas.estimateGasCost(1, context.network),
        },
      ],
      estimatedGas: await this.gas.estimateGasCost(1, context.network),
      estimatedOutcome: `Generic execution of ${intent.action}`,
      riskLevel: 'medium',
      warnings: [],
      reasoning,
      requiresApproval: true,
      totalFees: '0.00',
      confidence: 0.5,
    };
  }

  // ─── Context fetching ───────────────────────────────────────────────────

  private async fetchDeFiContext(context: UserContext): Promise<DeFiContext> {
    const [rates, pools, gasPrice] = await Promise.all([
      this.aave.getRates(context.network).catch(() => undefined),
      this.aerodrome.getPools(context.network).catch(() => []),
      this.gas.getGasPrice(context.network).catch(() => undefined),
    ]);

    return {
      balances: context.balances,
      network: context.network,
      address: context.address,
      gasPrice,
      protocols: {
        aave: rates ? { rates } : undefined,
        aerodrome: { pools },
      },
    };
  }
}
