/**
 * Held-out evaluation for EmbeddingClassifier.
 *
 * Loads labeled-intents.json, does a stratified 80/20 train/test split,
 * then runs kNN classification (same algorithm as EmbeddingClassifier) using
 * only the training 80% as the index.  Reports per-class accuracy and a
 * confusion matrix.
 *
 * Run with:
 *   npx tsx scripts/eval-classifier.ts
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface Example {
  input: string;
  action: string;
}

function cosineSim(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // unit-normalised embeddings → dot = cosine
}

/** Deterministic stratified split: every 5th example in each class → test. */
function stratifiedSplit(
  data: Example[],
): { train: Example[]; test: Example[] } {
  const byClass = new Map<string, Example[]>();
  for (const ex of data) {
    if (!byClass.has(ex.action)) byClass.set(ex.action, []);
    byClass.get(ex.action)!.push(ex);
  }

  const train: Example[] = [];
  const test: Example[] = [];
  for (const [, examples] of byClass) {
    for (let i = 0; i < examples.length; i++) {
      if (i % 5 === 0) test.push(examples[i]);
      else train.push(examples[i]);
    }
  }
  return { train, test };
}

async function main(): Promise<void> {
  const dataPath = join(__dirname, '..', 'src', 'data', 'labeled-intents.json');
  const data: Example[] = JSON.parse(readFileSync(dataPath, 'utf-8'));
  const classes = [...new Set(data.map((e) => e.action))].sort();

  console.log(`\nLoaded ${data.length} examples across ${classes.length} classes.`);

  const { train, test } = stratifiedSplit(data);
  console.log(
    `Split: ${train.length} train / ${test.length} test (stratified ~80/20)\n`,
  );

  console.log('Loading MiniLM-L6-v2 (may download on first run)...');
  const t0 = Date.now();
  const { pipeline } = await import('@xenova/transformers');
  const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  console.log(`Model ready in ${Date.now() - t0} ms\n`);

  // ── Embed training corpus ──────────────────────────────────────────────────
  console.log(`Embedding ${train.length} training examples...`);
  const trainInputs = train.map((e) => e.input);
  const trainOut = await extractor(trainInputs, { pooling: 'mean', normalize: true });
  const dim = (trainOut.data as Float32Array).length / trainInputs.length;
  const trainEmbs: Float32Array[] = [];
  for (let i = 0; i < trainInputs.length; i++) {
    trainEmbs.push(
      (trainOut.data as Float32Array).slice(i * dim, (i + 1) * dim) as Float32Array,
    );
  }
  const trainLabels = train.map((e) => e.action);

  // ── Classify test set ──────────────────────────────────────────────────────
  console.log(`Classifying ${test.length} test examples...\n`);
  const k = 5;

  const confusion = new Map<string, Map<string, number>>();
  for (const c of classes) confusion.set(c, new Map(classes.map((c2) => [c2, 0])));

  let correct = 0;

  for (const ex of test) {
    const qOut = await extractor(ex.input, { pooling: 'mean', normalize: true });
    const qEmb = qOut.data as Float32Array;

    const sims = trainEmbs.map((emb, i) => ({ s: cosineSim(qEmb, emb), i }));
    sims.sort((a, b) => b.s - a.s);
    const topK = sims.slice(0, k);

    const votes = new Map<string, number>();
    for (const { i } of topK) {
      const lbl = trainLabels[i];
      votes.set(lbl, (votes.get(lbl) ?? 0) + 1);
    }

    let predicted = 'clarify';
    let maxVotes = 0;
    for (const [lbl, cnt] of votes) {
      if (cnt > maxVotes) { maxVotes = cnt; predicted = lbl; }
    }

    if (predicted === ex.action) correct++;
    const row = confusion.get(ex.action)!;
    row.set(predicted, (row.get(predicted) ?? 0) + 1);
  }

  // ── Per-class accuracy ─────────────────────────────────────────────────────
  const colW = 22;
  console.log('Per-class accuracy:');
  console.log('─'.repeat(50));
  for (const c of classes) {
    const row = confusion.get(c)!;
    const total = [...row.values()].reduce((a, b) => a + b, 0);
    const classCorrect = row.get(c) ?? 0;
    const pct = total > 0 ? ((classCorrect / total) * 100).toFixed(1) : 'N/A';
    console.log(`  ${c.padEnd(colW)} ${String(classCorrect).padStart(3)}/${String(total).padEnd(3)}  (${pct}%)`);
  }
  console.log('─'.repeat(50));
  console.log(
    `  ${'OVERALL'.padEnd(colW)} ${correct}/${test.length}  (${((correct / test.length) * 100).toFixed(1)}%)\n`,
  );

  // ── Confusion matrix ───────────────────────────────────────────────────────
  const shortName = (s: string): string => s.slice(0, 5).padStart(5);
  console.log('Confusion matrix  (rows = actual, cols = predicted):');
  process.stdout.write('                      ');
  for (const c of classes) process.stdout.write(shortName(c) + ' ');
  console.log();

  for (const actual of classes) {
    process.stdout.write(`  ${actual.padEnd(20)}`);
    for (const predicted of classes) {
      const cnt = confusion.get(actual)!.get(predicted) ?? 0;
      process.stdout.write(String(cnt).padStart(5) + ' ');
    }
    console.log();
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
