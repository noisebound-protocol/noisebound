"""
Fine-tune DistilBERT on labeled-intents.json for GhostAction classification.

Usage:
    python scripts/train_classifier.py

Outputs:
    packages/ghost/models/ghost-intent-classifier.onnx  — ONNX model
    packages/ghost/models/label_map.json                — label → index mapping
"""

import json
import os
import time
from pathlib import Path
from collections import Counter

import numpy as np
from sklearn.model_selection import StratifiedShuffleSplit
from sklearn.metrics import classification_report, accuracy_score

import torch
import torch.nn.functional as F
from torch.utils.data import Dataset, DataLoader
from transformers import (
    DistilBertTokenizerFast,
    DistilBertForSequenceClassification,
    get_linear_schedule_with_warmup,
)

# ── Paths ─────────────────────────────────────────────────────────────────────
SCRIPT_DIR = Path(__file__).parent
PKG_DIR = SCRIPT_DIR.parent
DATA_PATH = PKG_DIR / "src" / "data" / "labeled-intents.json"
MODELS_DIR = PKG_DIR / "models"
MODELS_DIR.mkdir(exist_ok=True)

ONNX_PATH = MODELS_DIR / "ghost-intent-classifier.onnx"
LABEL_MAP_PATH = MODELS_DIR / "label_map.json"

# ── Hyperparameters ────────────────────────────────────────────────────────────
MODEL_NAME = "distilbert-base-uncased"
MAX_LEN = 64
BATCH_SIZE = 16
EPOCHS = 5
LR = 3e-5
SEED = 42

torch.manual_seed(SEED)
np.random.seed(SEED)


# ── Dataset ────────────────────────────────────────────────────────────────────
class IntentDataset(Dataset):
    def __init__(self, texts, labels, tokenizer):
        self.encodings = tokenizer(
            texts, truncation=True, padding="max_length", max_length=MAX_LEN
        )
        self.labels = labels

    def __len__(self):
        return len(self.labels)

    def __getitem__(self, idx):
        item = {k: torch.tensor(v[idx]) for k, v in self.encodings.items()}
        item["labels"] = torch.tensor(self.labels[idx], dtype=torch.long)
        return item


# ── Stratified split matching eval-classifier.ts logic ────────────────────────
# eval-classifier.ts: every 5th example in each class → test (index % 5 == 0)
def stratified_split(data: list[dict]) -> tuple[list, list]:
    by_class: dict[str, list] = {}
    for ex in data:
        by_class.setdefault(ex["action"], []).append(ex)

    train, test = [], []
    for examples in by_class.values():
        for i, ex in enumerate(examples):
            if i % 5 == 0:
                test.append(ex)
            else:
                train.append(ex)
    return train, test


def main():
    # ── Load data ──────────────────────────────────────────────────────────────
    with open(DATA_PATH) as f:
        data = json.load(f)

    print(f"Loaded {len(data)} examples")
    label_counts = Counter(ex["action"] for ex in data)
    print(f"Classes ({len(label_counts)}):")
    for label, count in sorted(label_counts.items()):
        print(f"  {label}: {count}")

    # Build label → index mapping (sorted for determinism)
    labels_sorted = sorted(label_counts.keys())
    label2idx = {l: i for i, l in enumerate(labels_sorted)}
    idx2label = {i: l for l, i in label2idx.items()}

    with open(LABEL_MAP_PATH, "w") as f:
        json.dump({"label2idx": label2idx, "idx2label": {str(k): v for k, v in idx2label.items()}}, f, indent=2)
    print(f"\nLabel map saved to {LABEL_MAP_PATH}")

    # ── Split ──────────────────────────────────────────────────────────────────
    train_data, test_data = stratified_split(data)
    print(f"\nSplit: {len(train_data)} train / {len(test_data)} test")

    train_texts = [ex["input"] for ex in train_data]
    train_labels = [label2idx[ex["action"]] for ex in train_data]
    test_texts = [ex["input"] for ex in test_data]
    test_labels = [label2idx[ex["action"]] for ex in test_data]

    # ── Tokenizer + model ──────────────────────────────────────────────────────
    print(f"\nLoading {MODEL_NAME}...")
    tokenizer = DistilBertTokenizerFast.from_pretrained(MODEL_NAME)
    model = DistilBertForSequenceClassification.from_pretrained(
        MODEL_NAME, num_labels=len(labels_sorted)
    )

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Device: {device}")
    model.to(device)

    # ── DataLoaders ────────────────────────────────────────────────────────────
    train_ds = IntentDataset(train_texts, train_labels, tokenizer)
    test_ds = IntentDataset(test_texts, test_labels, tokenizer)
    train_loader = DataLoader(train_ds, batch_size=BATCH_SIZE, shuffle=True)
    test_loader = DataLoader(test_ds, batch_size=32)

    # ── Optimizer + scheduler ──────────────────────────────────────────────────
    optimizer = torch.optim.AdamW(model.parameters(), lr=LR)
    total_steps = len(train_loader) * EPOCHS
    scheduler = get_linear_schedule_with_warmup(
        optimizer, num_warmup_steps=total_steps // 10, num_training_steps=total_steps
    )

    # ── Training loop ──────────────────────────────────────────────────────────
    print(f"\nTraining {EPOCHS} epochs on {len(train_ds)} examples...")
    print("-" * 55)

    for epoch in range(EPOCHS):
        model.train()
        total_loss = 0.0
        t0 = time.time()

        for batch in train_loader:
            batch = {k: v.to(device) for k, v in batch.items()}
            outputs = model(**batch)
            loss = outputs.loss
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            scheduler.step()
            optimizer.zero_grad()
            total_loss += loss.item()

        avg_loss = total_loss / len(train_loader)
        elapsed = time.time() - t0
        print(f"Epoch {epoch + 1}/{EPOCHS}  loss={avg_loss:.4f}  time={elapsed:.1f}s", flush=True)

    print("-" * 55)

    # ── Evaluation ─────────────────────────────────────────────────────────────
    print("\nEvaluating on held-out test set...")
    model.eval()
    all_preds, all_true = [], []

    with torch.no_grad():
        for batch in test_loader:
            batch = {k: v.to(device) for k, v in batch.items()}
            outputs = model(**batch)
            preds = torch.argmax(outputs.logits, dim=-1).cpu().numpy()
            all_preds.extend(preds)
            all_true.extend(batch["labels"].cpu().numpy())

    overall_acc = accuracy_score(all_true, all_preds)
    print(f"\nOverall accuracy: {overall_acc * 100:.1f}%  ({int(overall_acc * len(all_true))}/{len(all_true)})\n")

    report = classification_report(
        all_true, all_preds,
        target_names=labels_sorted,
        digits=3,
        zero_division=0,
    )
    print("Per-class breakdown:")
    print(report)

    # ── Save fine-tuned weights (so export can be retried without retraining) ─
    PT_PATH = MODELS_DIR / "ghost-intent-classifier.pt"
    torch.save(model.state_dict(), str(PT_PATH))
    print(f"Fine-tuned weights saved to {PT_PATH}")

    # ── ONNX export ────────────────────────────────────────────────────────────
    print(f"Exporting to ONNX -> {ONNX_PATH}")
    model.eval()
    model.cpu()

    dummy_input_ids = torch.zeros(1, MAX_LEN, dtype=torch.long)
    dummy_attention_mask = torch.ones(1, MAX_LEN, dtype=torch.long)

    torch.onnx.export(
        model,
        (dummy_input_ids, dummy_attention_mask),
        str(ONNX_PATH),
        input_names=["input_ids", "attention_mask"],
        output_names=["logits"],
        dynamic_axes={
            "input_ids": {0: "batch_size"},
            "attention_mask": {0: "batch_size"},
        },
        opset_version=14,
        do_constant_folding=True,
    )

    size_mb = ONNX_PATH.stat().st_size / (1024 * 1024)
    print(f"ONNX model saved ({size_mb:.1f} MB)")
    print(f"\nDone. Label map: {LABEL_MAP_PATH}")


if __name__ == "__main__":
    main()
