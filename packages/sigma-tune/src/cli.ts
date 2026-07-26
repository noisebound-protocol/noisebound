import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { generateDataset, toJsonl } from './generate.js';

function summarizeByCategory(examples: readonly { readonly category: string }[]): string {
  const counts = new Map<string, number>();
  for (const example of examples) {
    counts.set(example.category, (counts.get(example.category) ?? 0) + 1);
  }
  return [...counts.entries()].map(([category, count]) => `${category}: ${count}`).join(', ');
}

export async function main(): Promise<void> {
  const dataset = generateDataset();

  console.log(`Generated ${dataset.train.length} train / ${dataset.val.length} val examples.`);
  console.log(`  train — ${summarizeByCategory(dataset.train)}`);
  console.log(`  val   — ${summarizeByCategory(dataset.val)}`);

  const outDir = path.join(process.cwd(), 'training', 'data');
  await mkdir(outDir, { recursive: true });

  const trainPath = path.join(outDir, 'train.jsonl');
  const valPath = path.join(outDir, 'val.jsonl');
  await writeFile(trainPath, toJsonl(dataset.train), 'utf8');
  await writeFile(valPath, toJsonl(dataset.val), 'utf8');

  console.log(`\nWrote ${trainPath}`);
  console.log(`Wrote ${valPath}`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
