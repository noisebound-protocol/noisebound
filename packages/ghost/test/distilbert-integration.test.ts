/**
 * Integration test: real initClassifier() → parseAsync() path.
 *
 * Verifies that DistilBERT is ACTUALLY the classifier responding — not regex
 * or EmbeddingClassifier. Uses the same 10 smoke-test phrases from
 * scripts/smoke-distilbert.ts so results are directly comparable.
 *
 * Timeout: 90 s to cover ONNX session create + tokenizer download on cold cache.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DistilBertClassifier } from '../src/parser/DistilBertClassifier.js';
import { IntentParser } from '../src/parser/IntentParser.js';

const SMOKE_PHRASES: Array<{ input: string; expected: string }> = [
  { input: 'I want to put my ETH into a lending pool',                  expected: 'earn'             },
  { input: 'my DAI is just sitting there doing nothing, find it some yield', expected: 'earn'        },
  { input: 'let my USDC generate passive income for me',                expected: 'earn'             },
  { input: 'yo can you swap some tokens for me',                        expected: 'swap'             },
  { input: 'flip 200 USDT into ETH',                                    expected: 'swap'             },
  { input: 'get me out of this Aave position',                          expected: 'remove_liquidity' },
  { input: 'pull my liquidity from the Aerodrome pool',                 expected: 'remove_liquidity' },
  { input: 'I owe Aave, help me clear my debt',                         expected: 'repay'            },
  { input: 'move my stablecoins across to another chain',               expected: 'bridge'           },
  { input: 'how much USDC do I actually have right now?',               expected: 'query'            },
];

// ─── shared state filled in beforeAll ───────────────────────────────────────

let parser: IntentParser;
let activeClassifierName = 'unset';
let directBertError: string | null = null;  // set if DistilBertClassifier.init() threw
let coldStartMs = 0;

// ─── setup ──────────────────────────────────────────────────────────────────

beforeAll(async () => {
  // 1. Try DistilBertClassifier directly to surface any load error with its
  //    real message before IntentParser's catch swallows it.
  console.log('\n[Integration] Attempting direct DistilBertClassifier.init()…');
  const directBert = new DistilBertClassifier();
  try {
    const t0 = Date.now();
    await directBert.init();
    coldStartMs = Date.now() - t0;
    console.log(`[Integration] Direct DistilBertClassifier.init() succeeded in ${coldStartMs} ms`);
  } catch (err) {
    directBertError = err instanceof Error
      ? `${err.constructor.name}: ${err.message}`
      : String(err);
    console.error(`[Integration] Direct DistilBertClassifier.init() FAILED:\n  ${directBertError}`);
  }

  // 2. Init through IntentParser exactly as the API does.
  console.log('[Integration] Calling IntentParser.initClassifier()…');
  parser = new IntentParser();
  const t1 = Date.now();
  await parser.initClassifier();
  if (coldStartMs === 0) coldStartMs = Date.now() - t1;

  // 3. Introspect which classifier was actually wired in.
  const loadedClassifier = (parser as unknown as { classifier: unknown }).classifier;
  activeClassifierName = (loadedClassifier as { constructor: { name: string } } | null)
    ?.constructor?.name ?? 'null';

  console.log(`[Integration] IntentParser.classifier = ${activeClassifierName}`);
  console.log(`[Integration] Cold-start: ${coldStartMs} ms\n`);
}, 90_000);

// ─── test 1: confirm DistilBERT is the active classifier ────────────────────

describe('classifier identity', () => {
  it('DistilBertClassifier is the active classifier — not regex or EmbeddingClassifier', () => {
    if (directBertError) {
      // Surface the real failure reason so it isn't silently masked as a fallback.
      throw new Error(
        `DistilBertClassifier.init() failed — IntentParser silently fell back to ${activeClassifierName}.\n` +
        `Root cause: ${directBertError}\n\n` +
        `Possible causes:\n` +
        `  • onnxruntime-node native binding missing or wrong architecture\n` +
        `  • ONNX model files not found at packages/ghost/models/\n` +
        `  • Xenova/bert-base-uncased tokenizer download failed (network or cache)\n` +
        `  • ghost-intent-classifier.onnx.data mismatch or corruption`,
      );
    }
    expect(activeClassifierName).toBe('DistilBertClassifier');
  });
});

// ─── test 2: per-phrase classification results ───────────────────────────────

describe('parseAsync() via the real initClassifier() path', () => {
  for (const { input, expected } of SMOKE_PHRASES) {
    it(`"${input.slice(0, 48)}"`, async () => {
      const result = await parser.parseAsync(input);
      // Log which classifier handled this phrase — must be DistilBertClassifier.
      console.log(
        `  [${activeClassifierName}] "${input.slice(0, 42)}" ` +
        `→ ${result.action} (conf=${result.confidence.toFixed(3)}) ` +
        `expected=${expected} ${result.action === expected ? '✓' : '✗ MISS'}`,
      );
      expect(result.action).toBe(expected);
    }, 20_000);
  }
});
