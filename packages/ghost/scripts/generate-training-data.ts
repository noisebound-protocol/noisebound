/**
 * Generate labeled intent training data using Claude Haiku.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... npx tsx scripts/generate-training-data.ts
 *
 * Outputs: src/data/labeled-intents.json
 * Format:  Array<{ input: string; action: GhostAction }>
 *
 * Produces ~20 phrasings per class × 12 classes ≈ 240 examples.
 * Run this once (or whenever you want to refresh/expand the dataset).
 * The JSON file is committed so the EmbeddingClassifier works offline.
 */

import Anthropic from '@anthropic-ai/sdk';
import { writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

type GhostAction =
  | 'swap' | 'send' | 'earn' | 'stake' | 'borrow' | 'repay'
  | 'provide_liquidity' | 'remove_liquidity' | 'bridge' | 'approve'
  | 'query' | 'complex';

interface LabeledIntent {
  input: string;
  action: GhostAction;
}

// "lend" is not a GhostAction — examples are generated but mapped to "earn".
const CLASS_DESCRIPTIONS: Array<{ action: GhostAction; description: string; example: string }> = [
  {
    action: 'swap',
    description: 'Exchange one cryptocurrency token for another on a DEX (swap, exchange, convert, trade)',
    example: 'swap 2 ETH for USDC',
  },
  {
    action: 'send',
    description: 'Transfer tokens to another wallet address or named recipient (send, transfer, pay, wire)',
    example: 'send 100 USDC to 0x1234567890123456789012345678901234567890',
  },
  {
    action: 'earn',
    description: 'Deposit or supply assets to earn yield, interest, or APY — includes lending out tokens (earn, yield, lend, supply, deposit for interest)',
    example: 'I want to earn yield on my USDC',
  },
  {
    action: 'stake',
    description: 'Lock tokens in a staking contract or protocol rewards pool (stake, unstake, staking)',
    example: 'stake my ETH',
  },
  {
    action: 'borrow',
    description: 'Take out a loan against crypto collateral (borrow, loan, leverage, collateral)',
    example: 'borrow USDC against my ETH collateral',
  },
  {
    action: 'repay',
    description: 'Pay back an outstanding crypto loan or debt position (repay, pay back, payoff, pay off, settle debt)',
    example: 'repay my USDC loan',
  },
  {
    action: 'provide_liquidity',
    description: 'Add tokens to a DEX liquidity pool or AMM pair (provide liquidity, add liquidity, LP, become a liquidity provider)',
    example: 'provide liquidity to the ETH/USDC pool',
  },
  {
    action: 'remove_liquidity',
    description: 'Withdraw tokens from a DEX liquidity pool (remove liquidity, withdraw from pool, exit LP, pull out LP)',
    example: 'remove my liquidity from the pool',
  },
  {
    action: 'bridge',
    description: 'Move assets across blockchain networks via a bridge (bridge, cross-chain, cross chain)',
    example: 'bridge my ETH to Base',
  },
  {
    action: 'approve',
    description: 'Grant a smart contract permission to spend tokens (approve, set allowance, grant spending, revoke approval)',
    example: 'approve USDC spending for Uniswap',
  },
  {
    action: 'query',
    description: 'Ask about current state: balance, price, APY, portfolio value, transaction history, gas price (what is my balance, how much do I have, price of, show my history)',
    example: 'what is my balance',
  },
  {
    action: 'complex',
    description: 'A multi-step or conditional DeFi request that combines a named protocol with a constraint word like "only if", "unless", "no more than", "at least", "as long as"',
    example: 'swap ETH on Uniswap only if gas is under $5',
  },
];

const TOKENS = ['ETH', 'USDC', 'USDT', 'DAI', 'WETH', 'WBTC', 'AERO', 'WELL', 'OCT', 'CBBTC'];
const PROTOCOLS = ['Uniswap', 'Aave', 'Aerodrome'];

async function generatePhrasings(
  client: Anthropic,
  action: GhostAction,
  description: string,
  example: string,
): Promise<string[]> {
  const prompt = `You are generating training data for a DeFi AI assistant called Ghost.

Generate exactly 20 diverse natural-language phrasings that all express the following intent:
Action: ${action}
Description: ${description}
Example: "${example}"

Rules:
- Each phrasing must be a DIFFERENT user utterance that clearly expresses this specific action
- Vary length: some short (2-4 words), some medium (5-10 words), some conversational (10-20 words)
- Vary formality: casual slang, formal requests, voice-style, short commands, full sentences
- Include token names like ${TOKENS.join(', ')} where appropriate
- Include protocol names like ${PROTOCOLS.join(', ')} where appropriate for some examples
- For "complex" action: ALWAYS include a constraint phrase (only if, unless, no more than, at least, as long as) AND a protocol name
- Do NOT include explanations or commentary
- Output ONLY a JSON array of 20 strings, e.g.: ["phrase 1", "phrase 2", ...]
- Each phrase must be realistic natural language a DeFi user would actually say`;

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = message.content[0].type === 'text' ? message.content[0].text : '';
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    console.error(`Failed to parse response for ${action}:`, text.slice(0, 200));
    return [];
  }

  try {
    const phrases: string[] = JSON.parse(jsonMatch[0]);
    return phrases.filter((p) => typeof p === 'string' && p.trim().length > 0).slice(0, 20);
  } catch (e) {
    console.error(`JSON parse error for ${action}:`, e);
    return [];
  }
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('Error: ANTHROPIC_API_KEY environment variable is not set.');
    process.exit(1);
  }

  const client = new Anthropic({ apiKey });
  const dataset: LabeledIntent[] = [];

  for (const { action, description, example } of CLASS_DESCRIPTIONS) {
    console.log(`Generating phrasings for: ${action}...`);
    const phrasings = await generatePhrasings(client, action, description, example);
    console.log(`  Got ${phrasings.length} phrasings`);

    for (const input of phrasings) {
      dataset.push({ input: input.trim(), action });
    }

    // Small delay to avoid rate limiting
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  console.log(`\nTotal examples generated: ${dataset.length}`);

  const outDir = join(__dirname, '..', 'src', 'data');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, 'labeled-intents.json');
  writeFileSync(outPath, JSON.stringify(dataset, null, 2), 'utf-8');
  console.log(`Written to: ${outPath}`);

  // Summary per class
  const counts = new Map<string, number>();
  for (const { action } of dataset) {
    counts.set(action, (counts.get(action) ?? 0) + 1);
  }
  console.log('\nExamples per class:');
  for (const [action, count] of counts) {
    console.log(`  ${action}: ${count}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
