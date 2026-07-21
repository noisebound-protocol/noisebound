import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { SCENARIOS } from './scenarios.js';
import { loadRunnerConfigFromEnv, runAllScenarios, EndpointUnreachableError, EndpointRequestError } from './runner.js';
import { scoreAll, summarize, formatSummaryTable, buildJsonReport } from './scorer.js';

function timestampForFilename(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

export async function main(): Promise<void> {
  const config = loadRunnerConfigFromEnv();

  console.log(`Running ${SCENARIOS.length} scenarios x ${config.runsPerScenario} runs against ${config.model} @ ${config.baseUrl}...`);

  let runs;
  try {
    runs = await runAllScenarios(config, SCENARIOS);
  } catch (error) {
    if (error instanceof EndpointUnreachableError || error instanceof EndpointRequestError) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  const runScores = scoreAll(SCENARIOS, runs);
  const summary = summarize(SCENARIOS, runScores, { model: config.model, baseUrl: config.baseUrl });

  console.log('');
  console.log(formatSummaryTable(summary));

  const outDir = path.join(process.cwd(), 'eval-results');
  await mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `${timestampForFilename(new Date())}.json`);
  await writeFile(outPath, JSON.stringify(buildJsonReport(summary), null, 2), 'utf8');
  console.log(`\nJSON report written to ${outPath}`);

  if (summary.overallPassRate < 1) {
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
