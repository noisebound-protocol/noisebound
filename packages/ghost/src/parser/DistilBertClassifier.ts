import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import type { GhostAction } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface LabelMap {
  label2idx: Record<string, number>;
  idx2label: Record<string, string>;
}

interface ClassifyResult {
  action: GhostAction;
  confidence: number;
}

const MAX_LEN = 64;

// Extract a plain number[] from either a Tensor (.data) or a plain array returned by @xenova/transformers v2
function extractIds(x: unknown): number[] {
  if (Array.isArray(x)) return x as number[];
  const d = (x as Record<string, unknown>).data;
  if (d != null) return Array.from(d as ArrayLike<number>).map(Number);
  return Array.from(x as ArrayLike<number>).map(Number);
}

// Zero-pad to MAX_LEN and convert to BigInt64Array for onnxruntime-node
function padToBigInt64(ids: number[], len: number, padValue = 0): BigInt64Array {
  const out = new BigInt64Array(len).fill(BigInt(padValue));
  const n = Math.min(len, ids.length);
  for (let i = 0; i < n; i++) out[i] = BigInt(ids[i] ?? padValue);
  return out;
}

/**
 * DistilBertClassifier — ONNX-exported fine-tuned DistilBERT for GhostAction.
 *
 * Drop-in alternative to EmbeddingClassifier: same classify(text) interface,
 * single forward pass ~5-15 ms on CPU. Requires the ONNX model and label map
 * produced by scripts/train_classifier.py.
 *
 * Call init() once at startup, then classifyAsync() per utterance.
 */
export class DistilBertClassifier {
  private session: import('onnxruntime-node').InferenceSession | null = null;
  private tokenizer: ((text: string, opts: Record<string, unknown>) => { input_ids: unknown; attention_mask: unknown }) | null = null;
  private idx2label: Record<string, string> = {};

  async init(): Promise<void> {
    // VEIL_MODELS_DIR env var is preferred. Bundled prod path: bundle.js sits in
    // /opt/veil-api so join(__dirname,'models') = /opt/veil-api/models (correct).
    // Dev path: __dirname = packages/ghost/src/parser, so we walk up two levels.
    const modelsDir =
      process.env['VEIL_MODELS_DIR'] ??
      (process.env['NODE_ENV'] === 'production'
        ? join(__dirname, 'models')
        : join(__dirname, '..', '..', 'models'));
    const onnxPath = join(modelsDir, 'ghost-intent-classifier.onnx');
    const labelMapPath = join(modelsDir, 'label_map.json');

    const labelMap: LabelMap = JSON.parse(readFileSync(labelMapPath, 'utf-8'));
    this.idx2label = labelMap.idx2label;

    const ort = await import('onnxruntime-node');
    this.session = await ort.InferenceSession.create(onnxPath, {
      executionProviders: ['cpu'],
    });

    const { AutoTokenizer } = await import('@xenova/transformers');
    // DistilBERT uses the same WordPiece vocab as BERT.  Xenova/bert-base-uncased is
    // explicitly packaged for @xenova/transformers and avoids undefined-token issues.
    this.tokenizer = await AutoTokenizer.from_pretrained('Xenova/bert-base-uncased') as typeof this.tokenizer;

    console.log('[DistilBertClassifier] ONNX session ready, tokenizer loaded.');
  }

  async classifyAsync(text: string): Promise<ClassifyResult> {
    if (!this.session || !this.tokenizer) {
      throw new Error('DistilBertClassifier not initialized — call init() first.');
    }

    const t0 = Date.now();

    // Tokenize without padding — @xenova/transformers v2 padding='max_length' creates undefined
    // values in batch mode. Truncate here, then pad manually below.
    const encoded = this.tokenizer(text, {
      truncation: true,
      max_length: MAX_LEN,
    }) as { input_ids: unknown; attention_mask: unknown };

    const rawIds = extractIds(encoded.input_ids);
    const rawMask = extractIds(encoded.attention_mask);

    const ort = await import('onnxruntime-node');
    const inputIds = new ort.Tensor('int64', padToBigInt64(rawIds, MAX_LEN, 0), [1, MAX_LEN]);
    // attention_mask: 1 for real tokens, 0 for padding
    const attentionMask = new ort.Tensor('int64', padToBigInt64(rawMask, MAX_LEN, 0), [1, MAX_LEN]);

    const results = await this.session.run({ input_ids: inputIds, attention_mask: attentionMask });
    const logits = results['logits'].data as Float32Array;

    const latencyMs = Date.now() - t0;

    // Numerically stable softmax
    const maxLogit = Math.max(...Array.from(logits));
    const exps = Array.from(logits).map((v) => Math.exp(v - maxLogit));
    const sumExp = exps.reduce((a, b) => a + b, 0);
    const probs = exps.map((e) => e / sumExp);

    const predIdx = probs.indexOf(Math.max(...probs));
    const confidence = probs[predIdx];
    const action = (this.idx2label[String(predIdx)] ?? 'clarify') as GhostAction;

    console.debug(`[DistilBertClassifier] "${text.slice(0, 40)}" -> ${action} (${confidence.toFixed(3)}) in ${latencyMs}ms`);

    return { action, confidence };
  }
}
