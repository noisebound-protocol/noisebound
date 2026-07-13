/**
 * Smoke test for DistilBertClassifier — parallel to smoke-classifier.ts.
 * Run with: npx tsx scripts/smoke-distilbert.ts
 *
 * Requires the ONNX model from: python scripts/train_classifier.py
 */

import { DistilBertClassifier } from '../src/parser/DistilBertClassifier.js';

const TEST_PHRASES: Array<{ input: string; expectedAction: string }> = [
  // earn / lending
  { input: 'I want to put my ETH into a lending pool', expectedAction: 'earn' },
  { input: 'my DAI is just sitting there doing nothing, find it some yield', expectedAction: 'earn' },
  { input: 'let my USDC generate passive income for me', expectedAction: 'earn' },

  // swap — casual / paraphrased
  { input: 'yo can you swap some tokens for me', expectedAction: 'swap' },
  { input: 'flip 200 USDT into ETH', expectedAction: 'swap' },

  // remove_liquidity
  { input: 'get me out of this Aave position', expectedAction: 'remove_liquidity' },
  { input: 'pull my liquidity from the Aerodrome pool', expectedAction: 'remove_liquidity' },

  // repay
  { input: 'I owe Aave, help me clear my debt', expectedAction: 'repay' },

  // bridge
  { input: 'move my stablecoins across to another chain', expectedAction: 'bridge' },

  // query
  { input: 'how much USDC do I actually have right now?', expectedAction: 'query' },
];

async function main() {
  const classifier = new DistilBertClassifier();

  console.log('Initializing DistilBertClassifier (ONNX session load + tokenizer)...\n');
  const coldStart = Date.now();
  await classifier.init();
  const coldStartMs = Date.now() - coldStart;
  console.log(`Cold-start completed in ${coldStartMs} ms\n`);

  console.log('─'.repeat(90));
  console.log(
    'Input'.padEnd(50),
    'Expected'.padEnd(20),
    'Got'.padEnd(20),
    'Conf',
    'Pass?',
  );
  console.log('─'.repeat(90));

  let passes = 0;
  const failures: string[] = [];
  const latencies: number[] = [];

  for (const { input, expectedAction } of TEST_PHRASES) {
    const t0 = Date.now();
    const result = await classifier.classifyAsync(input);
    latencies.push(Date.now() - t0);

    const pass = result.action === expectedAction;
    if (pass) passes++;
    else failures.push(`"${input}" → got ${result.action}, expected ${expectedAction}`);

    console.log(
      input.slice(0, 48).padEnd(50),
      expectedAction.padEnd(20),
      result.action.padEnd(20),
      result.confidence.toFixed(3),
      pass ? '✓' : '✗  <-- MISS',
    );
  }

  console.log('─'.repeat(90));
  const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const maxLatency = Math.max(...latencies);
  console.log(`\nResult: ${passes}/${TEST_PHRASES.length} correct`);
  console.log(`Cold-start latency: ${coldStartMs} ms`);
  console.log(`Inference latency: avg=${avgLatency.toFixed(0)}ms  max=${maxLatency}ms`);

  if (failures.length) {
    console.log('\nMisclassifications:');
    for (const f of failures) console.log('  •', f);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
