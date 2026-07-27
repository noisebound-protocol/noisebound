import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { BROWSER_SCENARIOS } from './browserScenarios.js';
import { BROWSER_TOOL_SCHEMAS, BROWSER_SYSTEM_PROMPT } from './browserToolSchema.js';
import type { EvalToolset } from './runner.js';
import { loadRunnerConfigFromEnv, runAllScenarios, EndpointUnreachableError, EndpointRequestError } from './runner.js';
import { scoreAllBrowser, summarizeBrowser, formatBrowserSummaryTable, buildBrowserJsonReport } from './browserScorer.js';

const BROWSER_TOOLSET: EvalToolset = { systemPrompt: BROWSER_SYSTEM_PROMPT, tools: BROWSER_TOOL_SCHEMAS };

function timestampForFilename(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

export async function main(): Promise<void> {
  const config = loadRunnerConfigFromEnv();

  console.log(
    `Running ${BROWSER_SCENARIOS.length} browser scenarios x ${config.runsPerScenario} runs against ${config.model} @ ${config.baseUrl}...`,
  );

  let runs;
  try {
    runs = await runAllScenarios(config, BROWSER_TOOLSET, BROWSER_SCENARIOS);
  } catch (error) {
    if (error instanceof EndpointUnreachableError || error instanceof EndpointRequestError) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  const runScores = scoreAllBrowser(BROWSER_SCENARIOS, runs);
  const summary = summarizeBrowser(BROWSER_SCENARIOS, runScores, { model: config.model, baseUrl: config.baseUrl });

  console.log('');
  console.log(formatBrowserSummaryTable(summary));

  const outDir = path.join(process.cwd(), 'eval-results');
  await mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `browser-${timestampForFilename(new Date())}.json`);
  await writeFile(outPath, JSON.stringify(buildBrowserJsonReport(summary), null, 2), 'utf8');
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
