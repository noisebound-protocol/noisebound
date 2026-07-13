import fetch from 'node-fetch';
import { ethers } from 'ethers';
import { generatePQCKeypair, signTransaction, type PQCKeypair } from '@noisebound/pqc-wallet';
import { IntentParser } from './parser/IntentParser.js';
import { DeFiReasoner } from './reasoning/DeFiReasoner.js';
import { GhostTrainer } from './training/GhostTrainer.js';
import { pqcTransport } from './crypto/PQCTransport.js';
import { COORDINATOR_PUBLIC_KEY } from './crypto/keys.js';
import type { ParsedIntent, UserContext } from './parser/types.js';
import type { ExecutionPlan, ExecutionStep } from './reasoning/types.js';
import type { PQCLLMClient } from './llm/PQCLLMClient.js';

const DEFAULT_API_URL = 'https://api.veilprotocol.net';
const CHAIN_IDS: Record<UserContext['network'], number> = { base: 8453, 'base-sepolia': 84532 };

export interface GhostConfig {
  network: 'base' | 'base-sepolia';
  apiUrl?: string;
  /** Default: true */
  enableTraining?: boolean;
  nodeId?: string;
  /** Used to sign execution steps in sign(). Generated lazily if omitted. */
  keypair?: PQCKeypair;
  /** When provided, 'clarify' intents are answered via de-identified LLM instead of a static string. */
  llmClient?: PQCLLMClient;
}

export interface GhostResult {
  intent: ParsedIntent;
  /** Only present for intents that required the reasoning layer */
  plan?: ExecutionPlan;
  ghostResponse: string;
  executionReady: boolean;
  requiresClarification: boolean;
}

/**
 * Ghost — Veil's private AI agent. Single entry point for parsing user
 * intent, reasoning through DeFi execution, and signing the resulting plan.
 * Always addresses the user as Sovereign.
 */
export class Ghost {
  private readonly parser: IntentParser;
  private readonly reasoner: DeFiReasoner;
  private readonly trainer: GhostTrainer;
  private readonly config: GhostConfig;
  private lastInstruction = '';

  constructor(config: GhostConfig) {
    this.config = { apiUrl: DEFAULT_API_URL, enableTraining: true, ...config };
    this.parser = new IntentParser();
    this.reasoner = new DeFiReasoner();
    this.trainer = new GhostTrainer({ keypair: config.keypair, nodeId: config.nodeId });
  }

  async execute(instruction: string, context: UserContext): Promise<GhostResult> {
    this.lastInstruction = instruction;
    const intent = this.parser.parse(instruction, context);

    let plan: ExecutionPlan | undefined;
    if (intent.requiresReasoning) {
      plan = await this.reasoner.reason(intent, context);
    }

    const requiresClarification = intent.action === 'clarify';
    const executionReady = !requiresClarification && (plan ? plan.steps.length > 0 : intent.action !== 'query');

    // PQC: the response channel back to mobile is already encrypted via
    // x402-pqc ML-KEM-768 at the API layer — no change needed here.
    const result: GhostResult = {
      intent,
      plan,
      ghostResponse: intent.ghostResponse,
      executionReady,
      requiresClarification,
    };

    if (requiresClarification && this.config.llmClient) {
      try {
        result.ghostResponse = await this.config.llmClient.chat(
          [{ role: 'user', content: instruction }],
          context,
        );
      } catch {
        // fall back to intent.ghostResponse if LLM is unavailable
      }
    }

    if (this.config.enableTraining !== false && !requiresClarification) {
      const trainingPlan = plan ?? this.buildSyntheticPlan(intent);
      void this.trainer
        .collectTrainingPair(instruction, trainingPlan, 'success')
        .catch(() => {
          // training is best-effort and must never affect the response
        });
    }

    return result;
  }

  // PQC: ML-DSA-65 signing, quantum resistant
  /** Signs every step of an approved plan and broadcasts each signed step to api.veilprotocol.net/ghost/steps. */
  async sign(plan: ExecutionPlan, context: UserContext): Promise<{ txHashes: string[]; success: boolean }> {
    const keypair = this.config.keypair ?? (this.config.keypair = generatePQCKeypair());
    const txHashes: string[] = [];
    let success = true;

    for (const step of plan.steps) {
      let txHash: string;
      try {
        txHash = this.signStep(step, context, keypair);
        txHashes.push(txHash);
      } catch {
        success = false;
        continue;
      }

      // Broadcast the signed step to the Veil relay — best-effort, same resilience
      // pattern as FederatedCoordinator.initiateTrainingRound(). The route
      // api.veilprotocol.net/ghost/steps does not yet exist; it must be added to
      // packages/api before this does anything end-to-end in production.
      void (async () => {
        try {
          const envelope = await pqcTransport.seal({ txHash, step, network: context.network }, COORDINATOR_PUBLIC_KEY);
          const res = await fetch(`${this.config.apiUrl}/ghost/steps`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(envelope),
          });
          pqcTransport.recordBroadcast('ghost-step', res.ok);
        } catch {
          // api.veilprotocol.net/ghost/steps unreachable — warn only, never throw
          console.warn('[Ghost] sign(): /ghost/steps relay unreachable, signed step not broadcast');
          pqcTransport.recordBroadcast('ghost-step', false);
        }
      })();
    }

    if (this.config.enableTraining !== false) {
      void this.trainer
        .collectTrainingPair(this.lastInstruction, plan, success ? 'success' : 'failed', txHashes[0])
        .catch(() => {});
    }

    return { txHashes, success };
  }

  /** Streams Ghost's response token-by-token. Clarify intents pipe the Anthropic SSE stream
   *  through the generator; all other intents yield the static ghost response as a single chunk. */
  async *stream(
    instruction: string,
    context: UserContext,
  ): AsyncGenerator<string, void, unknown> {
    const intent = this.parser.parse(instruction, context);

    if (intent.action === 'clarify' && this.config.llmClient) {
      yield* this.config.llmClient.stream([{ role: 'user', content: instruction }], context);
      return;
    }

    const result = await this.execute(instruction, context);
    yield result.ghostResponse;
  }

  private signStep(step: ExecutionStep, context: UserContext, keypair: PQCKeypair): string {
    const tx: ethers.TransactionLike = {
      to: context.address,
      data: step.calldata ?? '0x',
      value: 0n,
      nonce: step.index,
      chainId: CHAIN_IDS[context.network],
    };
    const signature = signTransaction(tx, keypair.signingKey);
    const stepFingerprint = ethers.toUtf8Bytes(`${step.protocol}:${step.action}:${step.index}`);
    return ethers.keccak256(ethers.concat([stepFingerprint, signature]));
  }

  private buildSyntheticPlan(intent: ParsedIntent): ExecutionPlan {
    return {
      steps: [
        {
          index: 0,
          protocol: intent.params.protocol ?? 'none',
          action: intent.action,
          description: `${intent.action} (no reasoning required)`,
          params: Object.fromEntries(Object.entries(intent.params).map(([k, v]) => [k, String(v)])),
          estimatedGas: '0.00',
        },
      ],
      estimatedGas: '0.00',
      estimatedOutcome: `Direct execution of ${intent.action}`,
      riskLevel: 'low',
      warnings: [],
      reasoning: [],
      requiresApproval: false,
      totalFees: '0.00',
      confidence: intent.confidence,
    };
  }
}
