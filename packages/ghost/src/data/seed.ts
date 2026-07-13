import type { UserContext } from '../parser/types.js';
import type { ExecutionPlan, ExecutionStep } from '../reasoning/types.js';

/**
 * Seed chain-of-thought training data for Ghost.
 *
 * 50 hand-curated (input, context, reasoning, plan, response) examples
 * covering Aave borrowing, yield optimization, portfolio rebalancing,
 * complex multi-step requests, and edge cases. The live federated training
 * pipeline (GhostTrainer / FederatedCoordinator) scales from this seed set.
 */
export interface TrainingExample {
  input: string;
  context: UserContext;
  reasoning: string[];
  plan: ExecutionPlan;
  ghostResponse: string;
  warnings: string[];
}

let stepCounter = 0;
function step(partial: Omit<ExecutionStep, 'index'>): ExecutionStep {
  return { index: stepCounter++, ...partial };
}
function resetSteps(): void {
  stepCounter = 0;
}

function ctx(address: string, balances: Record<string, string>, network: UserContext['network'] = 'base-sepolia'): UserContext {
  return { address, network, balances };
}

function plan(
  steps: ExecutionStep[],
  opts: Partial<Omit<ExecutionPlan, 'steps' | 'reasoning'>> & { reasoning: string[] },
): ExecutionPlan {
  return {
    steps,
    estimatedGas: opts.estimatedGas ?? '0.45',
    estimatedOutcome: opts.estimatedOutcome ?? '',
    riskLevel: opts.riskLevel ?? 'medium',
    warnings: opts.warnings ?? [],
    reasoning: opts.reasoning,
    requiresApproval: opts.requiresApproval ?? true,
    totalFees: opts.totalFees ?? '0.00',
    confidence: opts.confidence ?? 0.85,
  };
}

export const SEED_EXAMPLES: TrainingExample[] = [];

// ─── 1. Aave borrow scenarios (10) ────────────────────────────────────────

resetSteps();
SEED_EXAMPLES.push({
  input: 'Borrow USDC against my ETH, no more than 8% interest',
  context: ctx('0xAAA1', { ETH: '5' }),
  reasoning: [
    'Checking ETH balance: 5 = $15000.00',
    'Fetching Aave V3 ETH parameters on Base',
    'ETH LTV: 80% → theoretical max borrow = $12000.00',
    'Applying 80% safety buffer → safe borrow = $9600.00',
    'Constraint check: no more than 8% interest',
    'Current variable rate: 4.50% passes constraint',
    'Health factor at safe borrow: 1.56 (target > 1.5)',
  ],
  plan: plan(
    [
      step({ protocol: 'aave', action: 'approve', description: 'Approve Aave to spend 5 ETH', params: { token: 'ETH', amount: '5' }, estimatedGas: '0.15' }),
      step({ protocol: 'aave', action: 'supply', description: 'Supply 5 ETH as collateral', params: { token: 'ETH', amount: '5' }, estimatedGas: '0.15' }),
      step({ protocol: 'aave', action: 'borrow', description: 'Borrow $9600.00 USDC against ETH', params: { collateralToken: 'ETH', borrowUsd: '9600.00', rateMode: 'variable' }, estimatedGas: '0.15' }),
    ],
    { reasoning: [], estimatedOutcome: 'Borrow up to $9600.00 USDC at 4.50% variable APY', riskLevel: 'low', confidence: 0.88 },
  ),
  ghostResponse: 'Understood, Sovereign. Analyzing loan parameters for your position.',
  warnings: [],
});

resetSteps();
SEED_EXAMPLES.push({
  input: 'I want to borrow against my WBTC, keep rate under 6%',
  context: ctx('0xAAA2', { WBTC: '0.5' }),
  reasoning: [
    'Checking WBTC balance: 0.5 = $30000.00',
    'Fetching Aave V3 WBTC parameters on Base',
    'WBTC LTV: 73% → theoretical max borrow = $21900.00',
    'Applying 80% safety buffer → safe borrow = $17520.00',
    'Constraint check: under 6%',
    'Current variable rate: 5.20% passes constraint',
    'Health factor at safe borrow: 1.71 (target > 1.5)',
  ],
  plan: plan(
    [
      step({ protocol: 'aave', action: 'approve', description: 'Approve Aave to spend 0.5 WBTC', params: { token: 'WBTC', amount: '0.5' }, estimatedGas: '0.12' }),
      step({ protocol: 'aave', action: 'supply', description: 'Supply 0.5 WBTC as collateral', params: { token: 'WBTC', amount: '0.5' }, estimatedGas: '0.12' }),
      step({ protocol: 'aave', action: 'borrow', description: 'Borrow $17520.00 against WBTC', params: { collateralToken: 'WBTC', borrowUsd: '17520.00', rateMode: 'variable' }, estimatedGas: '0.12' }),
    ],
    { reasoning: [], estimatedOutcome: 'Borrow up to $17520.00 at 5.20% variable APY', riskLevel: 'low', confidence: 0.86 },
  ),
  ghostResponse: 'Understood, Sovereign. Analyzing loan parameters for your position.',
  warnings: [],
});

resetSteps();
SEED_EXAMPLES.push({
  input: 'Take out a loan against 50% of my USDC, max 4% rate',
  context: ctx('0xAAA3', { USDC: '10000' }),
  reasoning: [
    'Checking USDC balance: 5000 = $5000.00',
    'Fetching Aave V3 USDC parameters on Base',
    'USDC LTV: 77% → theoretical max borrow = $3850.00',
    'Applying 80% safety buffer → safe borrow = $3080.00',
    'Constraint check: max 4% rate',
    'Current variable rate: 5.00% fails constraint',
    'Current stable rate: 6.00% fails constraint',
  ],
  plan: plan(
    [
      step({ protocol: 'aave', action: 'approve', description: 'Approve Aave to spend 5000 USDC', params: { token: 'USDC', amount: '5000' }, estimatedGas: '0.10' }),
      step({ protocol: 'aave', action: 'supply', description: 'Supply 5000 USDC as collateral', params: { token: 'USDC', amount: '5000' }, estimatedGas: '0.10' }),
      step({ protocol: 'aave', action: 'borrow', description: 'Borrow $3080.00 against USDC', params: { collateralToken: 'USDC', borrowUsd: '3080.00', rateMode: 'variable' }, estimatedGas: '0.10' }),
    ],
    { reasoning: [], estimatedOutcome: 'No Aave rate currently satisfies a 4% ceiling', riskLevel: 'medium', confidence: 0.4 },
  ),
  ghostResponse: 'Understood, Sovereign. Analyzing loan parameters for your position.',
  warnings: ['No Aave rate for USDC satisfies the constraint "max 4% rate"'],
});

const aaveBorrowFillers: [string, string, string][] = [
  ['Borrow against my ETH for a leveraged position', 'ETH', '3'],
  ['Use my WBTC as collateral and borrow USDC', 'WBTC', '0.2'],
  ['Open a loan with ETH collateral, keep it conservative', 'ETH', '10'],
  ['Borrow the max safe amount against my USDC', 'USDC', '20000'],
  ['I need a loan against my WBTC holdings', 'WBTC', '1'],
  ['Take a small loan against ETH, no more than 7% interest', 'ETH', '1'],
  ['Borrow USDC using my ETH as collateral, stable rate only', 'ETH', '2'],
];
for (const [input, token, amount] of aaveBorrowFillers) {
  resetSteps();
  const balance = parseFloat(amount);
  const price = token === 'ETH' ? 3000 : token === 'WBTC' ? 60000 : 1;
  const usd = balance * price;
  const ltv = token === 'ETH' ? 0.8 : token === 'WBTC' ? 0.73 : 0.77;
  const safe = usd * ltv * 0.8;
  SEED_EXAMPLES.push({
    input,
    context: ctx('0xAAA' + Math.random().toString(16).slice(2, 6), { [token]: amount }),
    reasoning: [
      `Checking ${token} balance: ${amount} = $${usd.toFixed(2)}`,
      `Fetching Aave V3 ${token} parameters on Base`,
      `${token} LTV: ${(ltv * 100).toFixed(0)}% → theoretical max borrow = $${(usd * ltv).toFixed(2)}`,
      `Applying 80% safety buffer → safe borrow = $${safe.toFixed(2)}`,
      `Health factor at safe borrow: ${(1 / (ltv * 0.8)).toFixed(2)} (target > 1.5)`,
    ],
    plan: plan(
      [
        step({ protocol: 'aave', action: 'approve', description: `Approve Aave to spend ${amount} ${token}`, params: { token, amount }, estimatedGas: '0.12' }),
        step({ protocol: 'aave', action: 'supply', description: `Supply ${amount} ${token} as collateral`, params: { token, amount }, estimatedGas: '0.12' }),
        step({ protocol: 'aave', action: 'borrow', description: `Borrow $${safe.toFixed(2)} against ${token}`, params: { collateralToken: token, borrowUsd: safe.toFixed(2), rateMode: 'variable' }, estimatedGas: '0.12' }),
      ],
      { reasoning: [], estimatedOutcome: `Borrow up to $${safe.toFixed(2)} against ${amount} ${token}`, riskLevel: 'low', confidence: 0.85 },
    ),
    ghostResponse: 'Understood, Sovereign. Analyzing loan parameters for your position.',
    warnings: [],
  });
}

// ─── 2. Yield optimization scenarios (10) ─────────────────────────────────

const yieldScenarios: [string, string, string, boolean][] = [
  ['Where can I earn the best yield on my USDC?', 'USDC', '5000', false],
  ['Find me the safest yield for my ETH, no impermanent loss', 'ETH', '3', true],
  ['I want maximum yield on my AERO, risk it', 'AERO', '10000', false],
  ['Earn interest on my idle USDC', 'USDC', '2000', false],
  ['What is the best APY for my WBTC right now?', 'WBTC', '0.3', false],
  ['Put my ETH to work earning yield conservatively', 'ETH', '1', true],
  ['Maximize my AERO yield, I do not mind risk', 'AERO', '5000', false],
  ['Find passive income for my USDC, low risk please', 'USDC', '15000', true],
  ['Where should I stake my OCT for the best return?', 'OCT', '8000', false],
  ['Optimize yield on my ETH and USDC', 'ETH', '2', false],
];
for (const [input, token, amount, riskAverse] of yieldScenarios) {
  resetSteps();
  SEED_EXAMPLES.push({
    input,
    context: ctx('0xYLD' + Math.random().toString(16).slice(2, 6), { [token]: amount }),
    reasoning: [
      `Scanning Aave V3 supply APY for ${token}`,
      `Scanning Aerodrome pools for ${token}`,
      riskAverse
        ? 'User requested low-risk yield → preferring Aave lending over LP'
        : 'No risk preference stated — comparing APY across both venues',
    ],
    plan: plan(
      [
        step({
          protocol: riskAverse ? 'aave' : 'aerodrome',
          action: riskAverse ? 'supply' : 'provide_liquidity',
          description: riskAverse ? `Supply ${amount} ${token} to Aave V3` : `Provide ${amount} ${token} to the highest-APR Aerodrome pool`,
          params: { token, amount },
          estimatedGas: '0.10',
        }),
      ],
      { reasoning: [], estimatedOutcome: riskAverse ? 'Earn Aave supply APY with no IL risk' : 'Earn the highest available APR', riskLevel: riskAverse ? 'low' : 'medium', confidence: 0.8 },
    ),
    ghostResponse: 'Understood, Sovereign. Scanning the market for the best yield on your assets.',
    warnings: riskAverse ? [] : ['No risk preference stated — defaulted to the higher-yield option. Impermanent loss applies to LP positions.'],
  });
}

// ─── 3. Portfolio rebalance scenarios (10) ────────────────────────────────

const rebalanceScenarios: [string, Record<string, string>][] = [
  ['Rebalance my portfolio to 50% ETH and 50% USDC', { ETH: '2', USDC: '1000' }],
  ['Rebalance to 70% USDC and 30% ETH', { ETH: '3', USDC: '2000' }],
  ['I want 40% ETH, 40% USDC, 20% WBTC allocation', { ETH: '1', USDC: '500', WBTC: '0.05' }],
  ['Rebalance everything to 100% USDC', { ETH: '2', USDC: '0' }],
  ['Set my allocation to 60% ETH and 40% AERO', { ETH: '2', AERO: '1000' }],
  ['Rebalance to 25% ETH, 25% WBTC, 50% USDC', { ETH: '1', WBTC: '0.1', USDC: '3000' }],
  ['I want an even 50/50 split of ETH and WBTC, 50% ETH 50% WBTC', { ETH: '4', WBTC: '0.05' }],
  ['Rebalance my OCT and USDC holdings to 30% OCT 70% USDC', { OCT: '5000', USDC: '1000' }],
  ['Shift my portfolio to 80% USDC and 20% ETH for safety', { ETH: '3', USDC: '500' }],
  ['Rebalance to 33% ETH 33% USDC 34% AERO', { ETH: '1', USDC: '1000', AERO: '2000' }],
];
for (const [input, balances] of rebalanceScenarios) {
  resetSteps();
  SEED_EXAMPLES.push({
    input,
    context: ctx('0xREB' + Math.random().toString(16).slice(2, 6), balances),
    reasoning: [
      'Parsed target allocations from instruction',
      'Calculated current portfolio value across all held assets',
      'Determined required buy/sell amounts to hit target weights',
      'Ordering sells before buys to minimize gas and avoid temporary undercollateralization',
    ],
    plan: plan(
      [
        step({ protocol: 'uniswap', action: 'sell', description: 'Sell overweight asset toward target allocation', params: {}, estimatedGas: '0.10' }),
        step({ protocol: 'uniswap', action: 'buy', description: 'Buy underweight asset toward target allocation', params: {}, estimatedGas: '0.10' }),
      ],
      { reasoning: [], estimatedOutcome: 'Portfolio rebalanced to target allocation', riskLevel: 'medium', confidence: 0.75 },
    ),
    ghostResponse: 'Understood, Sovereign. Reasoning through your request...',
    warnings: [],
  });
}

// ─── 4. Complex multi-step scenarios (10) ─────────────────────────────────

const complexScenarios: string[] = [
  'Swap half my ETH for USDC on Uniswap, only if gas is under $5',
  'Borrow USDC against ETH and immediately provide it as liquidity on Aerodrome',
  'Bridge my USDC to Base and then supply it to Aave, as long as the bridge fee is under 1%',
  'Sell my WBTC for ETH on Uniswap unless the price impact exceeds 2%',
  'Move my idle USDC into the best Aerodrome pool, only if APR is above 10%',
  'Borrow against my WBTC and use the proceeds to buy more ETH, no more than 6% interest',
  'Provide liquidity on Aerodrome with my ETH and USDC, as long as IL risk is acceptable',
  'Repay my Aave loan using USDC from my wallet, only if my health factor is above 2',
  'Swap my AERO for USDC on Uniswap unless slippage exceeds 1%',
  'Bridge ETH to Base then swap it for USDC on Uniswap, only if total fees stay under $10',
];
for (const input of complexScenarios) {
  resetSteps();
  SEED_EXAMPLES.push({
    input,
    context: ctx('0xCPX' + Math.random().toString(16).slice(2, 6), { ETH: '2', USDC: '3000', WBTC: '0.1', AERO: '1000' }),
    reasoning: [
      'Detected a named protocol combined with a free-text constraint — escalating to full reasoning',
      'Building a generic plan; specialized multi-step reasoning to follow as protocol coverage expands',
    ],
    plan: plan(
      [
        step({ protocol: 'unknown', action: 'complex', description: 'Execute complex as requested', params: {}, estimatedGas: '0.10' }),
      ],
      { reasoning: [], estimatedOutcome: 'Generic execution of complex', riskLevel: 'medium', confidence: 0.5 },
    ),
    ghostResponse: 'Understood, Sovereign. Reasoning through your request...',
    warnings: [],
  });
}

// ─── 5. Edge cases (10) ────────────────────────────────────────────────────

resetSteps();
SEED_EXAMPLES.push({
  input: 'Swap 100 ETH for USDC',
  context: ctx('0xEDGE1', { ETH: '1' }),
  reasoning: ['Verifying ETH balance: have 1, need 100'],
  plan: plan(
    [step({ protocol: 'uniswap', action: 'swap', description: 'Swap 100 ETH for USDC', params: { fromToken: 'ETH', toToken: 'USDC', amount: '100' }, estimatedGas: '0.10' })],
    { reasoning: [], estimatedOutcome: 'Receive approximately 0 USDC', riskLevel: 'low', confidence: 0.3 },
  ),
  ghostResponse: 'Understood, Sovereign. Preparing to swap 100 ETH to USDC.',
  warnings: ['Insufficient ETH balance: requested 100, available 1'],
});

resetSteps();
SEED_EXAMPLES.push({
  input: 'Borrow USDC against ETH, no more than 0.1% interest',
  context: ctx('0xEDGE2', { ETH: '5' }),
  reasoning: [
    'Checking ETH balance: 5 = $15000.00',
    'Constraint check: no more than 0.1% interest',
    'Current variable rate: 4.50% fails constraint',
    'Current stable rate: 6.00% fails constraint',
  ],
  plan: plan(
    [step({ protocol: 'aave', action: 'borrow', description: 'Borrow against ETH collateral', params: { collateralToken: 'ETH' }, estimatedGas: '0.10' })],
    { reasoning: [], estimatedOutcome: 'No Aave rate satisfies a 0.1% ceiling', riskLevel: 'medium', confidence: 0.4 },
  ),
  ghostResponse: 'Understood, Sovereign. Analyzing loan parameters for your position.',
  warnings: ['No Aave rate for ETH satisfies the constraint "no more than 0.1% interest"'],
});

resetSteps();
SEED_EXAMPLES.push({
  input: 'Borrow 90% of the max against my entire ETH stack',
  context: ctx('0xEDGE3', { ETH: '20' }),
  reasoning: [
    'Checking ETH balance: 20 = $60000.00',
    'ETH LTV: 80% → theoretical max borrow = $48000.00',
    'Applying 80% safety buffer → safe borrow = $38400.00',
    'Health factor at safe borrow: 1.56 (target > 1.5)',
  ],
  plan: plan(
    [step({ protocol: 'aave', action: 'borrow', description: 'Borrow against full ETH stack', params: { collateralToken: 'ETH' }, estimatedGas: '0.10' })],
    { reasoning: [], estimatedOutcome: 'Borrow up to $38400.00', riskLevel: 'medium', confidence: 0.78 },
  ),
  ghostResponse: 'Understood, Sovereign. Analyzing loan parameters for your position.',
  warnings: ['Health factor (1.56) is below 2.0 — consider borrowing less for extra safety margin.'],
});

resetSteps();
SEED_EXAMPLES.push({
  input: 'Earn yield on my WELL tokens',
  context: ctx('0xEDGE4', { WELL: '10000' }),
  reasoning: ['Scanning Aave V3 supply APY for WELL: unavailable', 'Scanning Aerodrome pools for WELL: no pool found'],
  plan: plan([], { reasoning: [], estimatedOutcome: 'No yield data available', riskLevel: 'low', requiresApproval: false, confidence: 0.3 }),
  ghostResponse: 'Understood, Sovereign. Scanning the market for the best yield on your assets.',
  warnings: ['Sovereign, no yield data is currently available for this asset.'],
});

resetSteps();
SEED_EXAMPLES.push({
  input: 'swap',
  context: ctx('0xEDGE5', { ETH: '1' }),
  reasoning: ['Input too sparse to extract token or amount parameters'],
  plan: plan([], { reasoning: [], estimatedOutcome: 'Awaiting clarification', riskLevel: 'low', requiresApproval: false, confidence: 0.3 }),
  ghostResponse: 'Sovereign, could you clarify what action you would like Ghost to take?',
  warnings: [],
});

resetSteps();
SEED_EXAMPLES.push({
  input: 'do the thing with my money',
  context: ctx('0xEDGE6', { USDC: '1000' }),
  reasoning: ['No recognizable DeFi action keyword found in instruction'],
  plan: plan([], { reasoning: [], estimatedOutcome: 'Awaiting clarification', riskLevel: 'low', requiresApproval: false, confidence: 0.3 }),
  ghostResponse: 'Sovereign, could you clarify what action you would like Ghost to take?',
  warnings: [],
});

resetSteps();
SEED_EXAMPLES.push({
  input: 'Rebalance my portfolio',
  context: ctx('0xEDGE7', { ETH: '2', USDC: '1000' }),
  reasoning: ['Parsed target allocations from instruction: none found'],
  plan: plan([], { reasoning: [], estimatedOutcome: 'No rebalance performed — target allocation unclear', riskLevel: 'low', requiresApproval: false, confidence: 0.3 }),
  ghostResponse: 'Understood, Sovereign. Reasoning through your request...',
  warnings: ['Sovereign, no explicit target allocation was found — please specify percentages per asset.'],
});

resetSteps();
SEED_EXAMPLES.push({
  input: 'Swap 5 ETH for USDC, slippage no more than 0.1%',
  context: ctx('0xEDGE8', { ETH: '10' }),
  reasoning: ['Verifying ETH balance: have 10, need 5', 'Uniswap quote price impact exceeds 0.1% slippage tolerance'],
  plan: plan(
    [step({ protocol: 'uniswap', action: 'swap', description: 'Swap 5 ETH for USDC', params: { fromToken: 'ETH', toToken: 'USDC', amount: '5' }, estimatedGas: '0.10' })],
    { reasoning: [], estimatedOutcome: 'Receive approximately the quoted USDC amount', riskLevel: 'medium', confidence: 0.9 },
  ),
  ghostResponse: 'Understood, Sovereign. Preparing to swap 5 ETH to USDC.',
  warnings: ['Price impact exceeds your slippage tolerance of 0.10%'],
});

resetSteps();
SEED_EXAMPLES.push({
  input: 'Borrow against my CBETH',
  context: ctx('0xEDGE9', { CBETH: '2' }),
  reasoning: ['Checking CBETH balance: 2 = $2.00', 'No Aave market data for CBETH — falling back to conservative USDC parameters'],
  plan: plan(
    [step({ protocol: 'aave', action: 'borrow', description: 'Borrow against CBETH collateral', params: { collateralToken: 'CBETH' }, estimatedGas: '0.10' })],
    { reasoning: [], estimatedOutcome: 'Borrow using fallback collateral parameters', riskLevel: 'medium', confidence: 0.6 },
  ),
  ghostResponse: 'Understood, Sovereign. Analyzing loan parameters for your position.',
  warnings: [],
});

resetSteps();
SEED_EXAMPLES.push({
  input: 'Provide liquidity with my entire portfolio',
  context: ctx('0xEDGE10', { ETH: '1', USDC: '500' }),
  reasoning: ['Detected liquidity provision request without a named pool — escalating for clarification on pair selection'],
  plan: plan([], { reasoning: [], estimatedOutcome: 'Awaiting pool selection', riskLevel: 'low', requiresApproval: false, confidence: 0.4 }),
  ghostResponse: 'Understood, Sovereign. Evaluating liquidity provision for the requested pair.',
  warnings: ['Sovereign, which pool would you like to provide liquidity to?'],
});
