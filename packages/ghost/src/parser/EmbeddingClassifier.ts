import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import type { GhostAction } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface LabeledIntent {
  input: string;
  action: GhostAction;
}

interface ClassifyResult {
  action: GhostAction;
  confidence: number;
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  // MiniLM with normalize=true produces unit vectors, so dot product = cosine similarity.
  return dot;
}

/**
 * EmbeddingClassifier — MiniLM-L6-v2 + cosine k-NN over labeled-intents.json.
 *
 * Call init() once at startup (downloads/caches the model), then classifyAsync()
 * per user utterance. The model is ~23 MB and cached to ~/.cache/huggingface by
 * @xenova/transformers.
 */
export class EmbeddingClassifier {
  private extractor: ((texts: string | string[], opts: Record<string, unknown>) => Promise<{ data: Float32Array }>) | null = null;
  private trainEmbeddings: Float32Array[] = [];
  private trainLabels: GhostAction[] = [];
  private readonly k = 5;

  async init(): Promise<void> {
    // Dynamic import keeps @xenova/transformers out of the module graph during
    // vitest runs — tests never call init(), so the model is never loaded.
    const { pipeline } = await import('@xenova/transformers');

    this.extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2') as typeof this.extractor;

    const dataPath = join(__dirname, '..', 'data', 'labeled-intents.json');
    const raw = readFileSync(dataPath, 'utf-8');
    const examples: LabeledIntent[] = JSON.parse(raw);

    const inputs = examples.map((e) => e.input);
    this.trainLabels = examples.map((e) => e.action);
    this.trainEmbeddings = await this.embedBatch(inputs);

    console.log(
      `[EmbeddingClassifier] Loaded ${examples.length} training examples, model ready.`,
    );
  }

  async classifyAsync(text: string): Promise<ClassifyResult> {
    if (!this.extractor) {
      throw new Error('EmbeddingClassifier not initialized — call init() first.');
    }

    const queryEmb = await this.embed(text);

    // Compute cosine similarity to every training example
    const sims = this.trainEmbeddings.map((emb) => cosineSimilarity(queryEmb, emb));

    // Top-k indices
    const indexed = sims.map((s, i) => ({ s, i }));
    indexed.sort((a, b) => b.s - a.s);
    const topK = indexed.slice(0, this.k);

    // Majority vote
    const votes = new Map<GhostAction, number>();
    for (const { i } of topK) {
      const label = this.trainLabels[i];
      votes.set(label, (votes.get(label) ?? 0) + 1);
    }

    let winner: GhostAction = 'clarify';
    let maxVotes = 0;
    for (const [label, count] of votes) {
      if (count > maxVotes) {
        maxVotes = count;
        winner = label;
      }
    }

    // Confidence = winner vote share, scaled by average similarity of its winners
    const winnerSims = topK
      .filter(({ i }) => this.trainLabels[i] === winner)
      .map(({ s }) => s);
    const avgSim = winnerSims.reduce((a, b) => a + b, 0) / winnerSims.length;
    const confidence = Math.max(0.2, Math.min(0.97, avgSim));

    return { action: winner, confidence };
  }

  private async embed(text: string): Promise<Float32Array> {
    const out = await this.extractor!(text, { pooling: 'mean', normalize: true });
    return out.data;
  }

  private async embedBatch(texts: string[]): Promise<Float32Array[]> {
    // @xenova/transformers handles batching internally when given an array
    const out = await this.extractor!(texts, { pooling: 'mean', normalize: true });
    const dim = out.data.length / texts.length;
    const results: Float32Array[] = [];
    for (let i = 0; i < texts.length; i++) {
      results.push(out.data.slice(i * dim, (i + 1) * dim) as Float32Array);
    }
    return results;
  }
}
