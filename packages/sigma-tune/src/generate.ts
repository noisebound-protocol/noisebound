import { buildAllScenarios } from './scenarios.js';
import { buildExample } from './example.js';
import type { TrainingExample } from './example.js';

export interface GeneratedDataset {
  readonly train: readonly TrainingExample[];
  readonly val: readonly TrainingExample[];
}

/** Deterministic PRNG (mulberry32) — the split must be reproducible across runs. */
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const shuffled = [...items];
  const random = mulberry32(seed);
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const a = shuffled[i];
    const b = shuffled[j];
    if (a === undefined || b === undefined) {
      throw new Error('seededShuffle: index out of range');
    }
    shuffled[i] = b;
    shuffled[j] = a;
  }
  return shuffled;
}

const DEFAULT_SEED = 20260726;
const DEFAULT_VAL_FRACTION = 0.1;

export interface GenerateOptions {
  readonly seed?: number;
  readonly valFraction?: number;
}

/**
 * Builds every scenario variant from scenarios.ts, converts each to a
 * training example, and produces a reproducible train/val split. The split
 * is stratified by category so a small category (e.g. session-key-issuance)
 * isn't accidentally left entirely out of one side.
 */
export function generateDataset(options: GenerateOptions = {}): GeneratedDataset {
  const seed = options.seed ?? DEFAULT_SEED;
  const valFraction = options.valFraction ?? DEFAULT_VAL_FRACTION;

  const scenarios = buildAllScenarios();
  const examples = scenarios.map((scenario) => buildExample(scenario));

  const byCategory = new Map<string, TrainingExample[]>();
  for (const example of examples) {
    const bucket = byCategory.get(example.category) ?? [];
    bucket.push(example);
    byCategory.set(example.category, bucket);
  }

  const train: TrainingExample[] = [];
  const val: TrainingExample[] = [];

  for (const [category, bucket] of byCategory) {
    const shuffled = seededShuffle(bucket, seed + hashString(category));
    const valCount = Math.max(1, Math.round(shuffled.length * valFraction));
    val.push(...shuffled.slice(0, valCount));
    train.push(...shuffled.slice(valCount));
  }

  return {
    train: seededShuffle(train, seed),
    val: seededShuffle(val, seed + 1),
  };
}

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (Math.imul(hash, 31) + value.charCodeAt(i)) | 0;
  }
  return hash;
}

export function toJsonl(examples: readonly TrainingExample[]): string {
  return examples.map((example) => JSON.stringify({ tools: example.tools, messages: example.messages })).join('\n') + '\n';
}
