import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// src/parser/DistilBertClassifier.ts
var __dirname$1 = dirname(fileURLToPath(import.meta.url));
var MAX_LEN = 64;
function extractIds(x) {
  if (Array.isArray(x)) return x;
  const d = x.data;
  if (d != null) return Array.from(d).map(Number);
  return Array.from(x).map(Number);
}
function padToBigInt64(ids, len, padValue = 0) {
  const out = new BigInt64Array(len).fill(BigInt(padValue));
  const n = Math.min(len, ids.length);
  for (let i = 0; i < n; i++) out[i] = BigInt(ids[i] ?? padValue);
  return out;
}
var DistilBertClassifier = class {
  session = null;
  tokenizer = null;
  idx2label = {};
  async init() {
    const modelsDir = process.env["VEIL_MODELS_DIR"] ?? (process.env["NODE_ENV"] === "production" ? join(__dirname$1, "models") : join(__dirname$1, "..", "..", "models"));
    const onnxPath = join(modelsDir, "ghost-intent-classifier.onnx");
    const labelMapPath = join(modelsDir, "label_map.json");
    const labelMap = JSON.parse(readFileSync(labelMapPath, "utf-8"));
    this.idx2label = labelMap.idx2label;
    const ort = await import('onnxruntime-node');
    this.session = await ort.InferenceSession.create(onnxPath, {
      executionProviders: ["cpu"]
    });
    const { AutoTokenizer } = await import('@xenova/transformers');
    this.tokenizer = await AutoTokenizer.from_pretrained("Xenova/bert-base-uncased");
    console.log("[DistilBertClassifier] ONNX session ready, tokenizer loaded.");
  }
  async classifyAsync(text) {
    if (!this.session || !this.tokenizer) {
      throw new Error("DistilBertClassifier not initialized \u2014 call init() first.");
    }
    const t0 = Date.now();
    const encoded = this.tokenizer(text, {
      truncation: true,
      max_length: MAX_LEN
    });
    const rawIds = extractIds(encoded.input_ids);
    const rawMask = extractIds(encoded.attention_mask);
    const ort = await import('onnxruntime-node');
    const inputIds = new ort.Tensor("int64", padToBigInt64(rawIds, MAX_LEN, 0), [1, MAX_LEN]);
    const attentionMask = new ort.Tensor("int64", padToBigInt64(rawMask, MAX_LEN, 0), [1, MAX_LEN]);
    const results = await this.session.run({ input_ids: inputIds, attention_mask: attentionMask });
    const logits = results["logits"].data;
    const latencyMs = Date.now() - t0;
    const maxLogit = Math.max(...Array.from(logits));
    const exps = Array.from(logits).map((v) => Math.exp(v - maxLogit));
    const sumExp = exps.reduce((a, b) => a + b, 0);
    const probs = exps.map((e) => e / sumExp);
    const predIdx = probs.indexOf(Math.max(...probs));
    const confidence = probs[predIdx];
    const action = this.idx2label[String(predIdx)] ?? "clarify";
    console.debug(`[DistilBertClassifier] "${text.slice(0, 40)}" -> ${action} (${confidence.toFixed(3)}) in ${latencyMs}ms`);
    return { action, confidence };
  }
};

export { DistilBertClassifier };
//# sourceMappingURL=DistilBertClassifier-OFXDEU64.js.map
//# sourceMappingURL=DistilBertClassifier-OFXDEU64.js.map