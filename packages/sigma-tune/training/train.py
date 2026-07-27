"""
Unsloth QLoRA SFT training script for sigma-tune's generated dataset.

Thin by design: all the tuning knobs live in lora_config.yaml, not here. Run
`pnpm --filter @noisebound/sigma-tune generate` first to produce
training/data/{train,val}.jsonl, then see training/README.md for the exact
environment setup and invocation.

    python training/train.py [path/to/lora_config.yaml]
"""

from __future__ import annotations

import sys
from pathlib import Path

import yaml
from datasets import load_dataset
from transformers import TrainingArguments
from trl import SFTTrainer
from unsloth import FastLanguageModel, is_bfloat16_supported
from unsloth.chat_templates import get_chat_template, train_on_responses_only


def load_config(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def build_formatting_func(tokenizer):
    """
    Renders each {"tools": [...], "messages": [...]} example through Qwen3's
    own chat template, tool definitions included, so the model trains on
    exactly the tokens/tags (e.g. <tool_call>) it will need to produce at
    inference time.
    """

    def format_example(example: dict) -> dict:
        text = tokenizer.apply_chat_template(
            example["messages"],
            tools=example["tools"],
            tokenize=False,
            add_generation_prompt=False,
        )
        return {"text": text}

    return format_example


def main() -> None:
    config_path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).parent / "lora_config.yaml"
    config = load_config(config_path)

    model_cfg = config["model"]
    lora_cfg = config["lora"]
    data_cfg = config["data"]
    train_cfg = config["training"]

    repo_root = config_path.parent.parent
    train_file = repo_root / data_cfg["train_file"]
    val_file = repo_root / data_cfg["val_file"]
    if not train_file.exists() or not val_file.exists():
        raise SystemExit(
            f"Dataset not found at {train_file} / {val_file}.\n"
            "Run `pnpm --filter @noisebound/sigma-tune generate` first."
        )

    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=model_cfg["base_model"],
        max_seq_length=model_cfg["max_seq_length"],
        dtype=model_cfg["dtype"],
        load_in_4bit=model_cfg["load_in_4bit"],
    )

    tokenizer = get_chat_template(tokenizer, chat_template=data_cfg["chat_template"])

    model = FastLanguageModel.get_peft_model(
        model,
        r=lora_cfg["r"],
        lora_alpha=lora_cfg["lora_alpha"],
        lora_dropout=lora_cfg["lora_dropout"],
        bias=lora_cfg["bias"],
        target_modules=lora_cfg["target_modules"],
        use_gradient_checkpointing=lora_cfg["use_gradient_checkpointing"],
        random_state=lora_cfg["random_state"],
    )

    dataset = load_dataset(
        "json",
        data_files={"train": str(train_file), "validation": str(val_file)},
    )
    formatting_func = build_formatting_func(tokenizer)
    dataset = dataset.map(formatting_func, remove_columns=dataset["train"].column_names)

    training_args = TrainingArguments(
        output_dir=str(repo_root / train_cfg["output_dir"]),
        num_train_epochs=train_cfg["num_train_epochs"],
        per_device_train_batch_size=train_cfg["per_device_train_batch_size"],
        gradient_accumulation_steps=train_cfg["gradient_accumulation_steps"],
        learning_rate=float(train_cfg["learning_rate"]),
        lr_scheduler_type=train_cfg["lr_scheduler_type"],
        warmup_ratio=train_cfg["warmup_ratio"],
        optim=train_cfg["optim"],
        weight_decay=train_cfg["weight_decay"],
        max_grad_norm=train_cfg["max_grad_norm"],
        logging_steps=train_cfg["logging_steps"],
        eval_strategy=train_cfg["eval_strategy"],
        eval_steps=train_cfg["eval_steps"],
        save_strategy=train_cfg["save_strategy"],
        save_steps=train_cfg["save_steps"],
        save_total_limit=train_cfg["save_total_limit"],
        seed=train_cfg["seed"],
        report_to=train_cfg["report_to"],
        bf16=is_bfloat16_supported(),
        fp16=not is_bfloat16_supported(),
    )

    trainer = SFTTrainer(
        model=model,
        tokenizer=tokenizer,
        train_dataset=dataset["train"],
        eval_dataset=dataset["validation"],
        dataset_text_field="text",
        max_seq_length=model_cfg["max_seq_length"],
        args=training_args,
        packing=False,  # tool-call turn boundaries must stay exact, never packed/concatenated
    )

    if data_cfg["train_on_responses_only"]:
        # Masks loss to assistant turns only — Qwen3's chat template renders
        # each turn with these instruction/response tag pairs.
        trainer = train_on_responses_only(
            trainer,
            instruction_part="<|im_start|>user\n",
            response_part="<|im_start|>assistant\n",
        )

    trainer.train()

    final_dir = repo_root / train_cfg["output_dir"] / "final"
    model.save_pretrained(str(final_dir))
    tokenizer.save_pretrained(str(final_dir))
    print(f"Saved final LoRA adapter to {final_dir}")


if __name__ == "__main__":
    main()
