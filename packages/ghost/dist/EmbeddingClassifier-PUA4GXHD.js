import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// src/parser/EmbeddingClassifier.ts
var __dirname$1 = dirname(fileURLToPath(import.meta.url));
function cosineSimilarity(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}
var EmbeddingClassifier = class {
  extractor = null;
  trainEmbeddings = [];
  trainLabels = [];
  k = 5;
  async init() {
    const { pipeline } = await import('@xenova/transformers');
    this.extractor = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
    const dataPath = join(__dirname$1, "..", "data", "labeled-intents.json");
    const raw = readFileSync(dataPath, "utf-8");
    const examples = JSON.parse(raw);
    const inputs = examples.map((e) => e.input);
    this.trainLabels = examples.map((e) => e.action);
    this.trainEmbeddings = await this.embedBatch(inputs);
    console.log(
      `[EmbeddingClassifier] Loaded ${examples.length} training examples, model ready.`
    );
  }
  async classifyAsync(text) {
    if (!this.extractor) {
      throw new Error("EmbeddingClassifier not initialized \u2014 call init() first.");
    }
    const queryEmb = await this.embed(text);
    const sims = this.trainEmbeddings.map((emb) => cosineSimilarity(queryEmb, emb));
    const indexed = sims.map((s, i) => ({ s, i }));
    indexed.sort((a, b) => b.s - a.s);
    const topK = indexed.slice(0, this.k);
    const votes = /* @__PURE__ */ new Map();
    for (const { i } of topK) {
      const label = this.trainLabels[i];
      votes.set(label, (votes.get(label) ?? 0) + 1);
    }
    let winner = "clarify";
    let maxVotes = 0;
    for (const [label, count] of votes) {
      if (count > maxVotes) {
        maxVotes = count;
        winner = label;
      }
    }
    const winnerSims = topK.filter(({ i }) => this.trainLabels[i] === winner).map(({ s }) => s);
    const avgSim = winnerSims.reduce((a, b) => a + b, 0) / winnerSims.length;
    const confidence = Math.max(0.2, Math.min(0.97, avgSim));
    return { action: winner, confidence };
  }
  async embed(text) {
    const out = await this.extractor(text, { pooling: "mean", normalize: true });
    return out.data;
  }
  async embedBatch(texts) {
    const out = await this.extractor(texts, { pooling: "mean", normalize: true });
    const dim = out.data.length / texts.length;
    const results = [];
    for (let i = 0; i < texts.length; i++) {
      results.push(out.data.slice(i * dim, (i + 1) * dim));
    }
    return results;
  }
};

export { EmbeddingClassifier };
//# sourceMappingURL=EmbeddingClassifier-PUA4GXHD.js.map
//# sourceMappingURL=EmbeddingClassifier-PUA4GXHD.js.map