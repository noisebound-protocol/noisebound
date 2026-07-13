/**
 * AgentCircle — Circle configured for private DeFi agent execution.
 *
 * Spending limits are enforced in TypeScript before any execution reaches
 * the Circle layer. This is real logic, not mocked.
 *
 * The VeilLM call and Circle submission are mocked with correct interfaces
 * until the distributed inference network and Octra Node.js SDK ship.
 */

import { sha256 } from '@noble/hashes/sha256';
import { Circle, deployCircle } from './circle.js';
import { VeilLMClient } from './inference.js';
import type {
  AgentConfig,
  CircleConfig,
  ExecutionPlan,
  ExecutionResult,
  ExecutionStep,
  ParsedIntent,
  SessionConfig,
} from './types.js';

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

export class SpendingLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpendingLimitError';
  }
}

export class ProtocolNotAllowedError extends Error {
  constructor(protocol: string, agentId: string) {
    super(`Protocol "${protocol}" is not in the allowed list for agent "${agentId}"`);
    this.name = 'ProtocolNotAllowedError';
  }
}

export class AgentCircle extends Circle {
  private readonly veilLM: VeilLMClient;
  private readonly history: ExecutionResult[] = [];

  private dailySpend: bigint = 0n;
  private totalSpend: bigint = 0n;
  private dailyWindowStart: number = Date.now();

  constructor(
    circleAddress: string,
    circleName: string,
    deploymentTx: string,
    public readonly agentConfig: AgentConfig,
    /**
     * Optional FHE session config. When provided, executeInstruction() routes
     * all VeilLM queries through private_predict inside a sealed CircleSession
     * so no instruction plaintext is visible to any external node.
     * Omit to use the local regex mock (useful for tests without a keypair).
     */
    sessionConfig?: SessionConfig,
  ) {
    super(circleAddress, circleName, deploymentTx);
    this.veilLM = new VeilLMClient(circleAddress, sessionConfig);
  }

  /**
   * Parses a natural language DeFi instruction into a structured ExecutionPlan.
   *
   * Uses VeilLM (mocked) for intent parsing, then validates the plan against
   * spending limits and allowed protocols before returning it.
   *
   * Throws SpendingLimitError or ProtocolNotAllowedError rather than
   * silently returning a plan that would fail on submitExecution.
   */
  async executeInstruction(instruction: string): Promise<ExecutionPlan> {
    const result = await this.veilLM.query(instruction, {
      availableProtocols: this.agentConfig.allowedProtocols,
      userBalances: {},
    });

    const plan = buildExecutionPlan(result.intent, this.agentConfig.allowedProtocols);

    // Validate protocol allowlist
    for (const protocol of plan.protocols) {
      if (!this.agentConfig.allowedProtocols.includes(protocol)) {
        throw new ProtocolNotAllowedError(protocol, this.agentConfig.agentId);
      }
    }

    // Validate per-tx spending limit
    if (plan.estimatedCost > this.agentConfig.spendingLimits.maxPerTx) {
      throw new SpendingLimitError(
        `Estimated cost ${plan.estimatedCost} μOCT exceeds per-tx limit ` +
          `${this.agentConfig.spendingLimits.maxPerTx} μOCT for agent "${this.agentConfig.agentId}"`,
      );
    }

    return plan;
  }

  /**
   * Submits a validated ExecutionPlan for sealed execution inside the Circle.
   *
   * Enforces daily and lifetime spending limits before forwarding to the
   * Circle execution layer (mocked until Octra SDK matures).
   *
   * TODO: replace mock Circle execution with real Circle.execute() call
   * once Octra's program.call is accessible from Node.js.
   */
  async submitExecution(plan: ExecutionPlan): Promise<ExecutionResult> {
    this.resetDailyWindowIfNeeded();

    if (this.dailySpend + plan.estimatedCost > this.agentConfig.spendingLimits.maxPerDay) {
      throw new SpendingLimitError(
        `Daily spend ${this.dailySpend + plan.estimatedCost} μOCT would exceed limit ` +
          `${this.agentConfig.spendingLimits.maxPerDay} μOCT for agent "${this.agentConfig.agentId}"`,
      );
    }

    if (this.totalSpend + plan.estimatedCost > this.agentConfig.spendingLimits.maxTotal) {
      throw new SpendingLimitError(
        `Lifetime spend ${this.totalSpend + plan.estimatedCost} μOCT would exceed limit ` +
          `${this.agentConfig.spendingLimits.maxTotal} μOCT for agent "${this.agentConfig.agentId}"`,
      );
    }

    const txHashes = plan.steps.map((step, i) =>
      '0x' +
      toHex(
        sha256(
          new TextEncoder().encode(
            `${this.address}:${step.protocol}:${step.action}:${i}:${Date.now()}`,
          ),
        ),
      ),
    );

    const actualCost = plan.estimatedCost;
    this.dailySpend += actualCost;
    this.totalSpend += actualCost;

    const result: ExecutionResult = {
      success: true,
      plan,
      txHashes,
      actualCost,
      timestamp: Date.now(),
    };

    this.history.push(result);
    return result;
  }

  /** Returns the full execution history for this AgentCircle. */
  async getExecutionHistory(): Promise<ExecutionResult[]> {
    return [...this.history];
  }

  private resetDailyWindowIfNeeded(): void {
    if (Date.now() - this.dailyWindowStart >= 86_400_000) {
      this.dailySpend = 0n;
      this.dailyWindowStart = Date.now();
    }
  }
}

/**
 * Creates an AgentCircle — a Circle configured for DeFi agent execution.
 *
 * The biometric authProof in AgentConfig is verified structurally
 * (non-empty proof bytes) but not cryptographically here — the ZK
 * verification lives in @veil/auth and is expected to have been run
 * by the caller before constructing AgentConfig.
 */
export async function createAgentCircle(
  agentConfig: AgentConfig,
  sessionConfig?: SessionConfig,
): Promise<AgentCircle> {
  if (agentConfig.authProof) {
    if (
      !agentConfig.authProof.proof ||
      agentConfig.authProof.proof.length === 0
    ) {
      throw new Error('AgentConfig.authProof provided but proof bytes are empty');
    }
  }

  const circleConfig: CircleConfig = {
    name: `agent-circle-${agentConfig.agentId}`,
    // Minimal AML program stub — real agent logic compiled separately
    program: `contract AgentCircle { state { agent_id: string } constructor() { self.agent_id = "${agentConfig.agentId}" } }`,
    programRuntime: 'octb',
    initialState: { agentId: agentConfig.agentId, allowedProtocols: agentConfig.allowedProtocols },
    keypair: agentConfig.keypair,
  };

  const circle = await deployCircle(circleConfig);

  return new AgentCircle(
    circle.address,
    circle.name,
    circle.deploymentTx,
    agentConfig,
    sessionConfig,
  );
}

// ─── Plan builder ─────────────────────────────────────────────────────────────

function buildExecutionPlan(intent: ParsedIntent, allowedProtocols: string[]): ExecutionPlan {
  const steps: ExecutionStep[] = [];
  const protocols: string[] = [];

  const protocol = intent.protocol ?? allowedProtocols[0] ?? 'unknown';
  if (!protocols.includes(protocol)) protocols.push(protocol);

  const baseGas = 50_000n; // μOCT base

  switch (intent.action) {
    case 'swap':
      steps.push({
        protocol,
        action: 'swap',
        params: {
          fromToken: intent.fromToken ?? 'ETH',
          toToken: intent.toToken ?? 'USDC',
          amount: intent.amount ?? '0',
          slippageTolerance: intent.slippageTolerance ?? 0.005,
        },
        estimatedCost: baseGas * 3n,
      });
      break;

    case 'lend':
      steps.push({
        protocol,
        action: 'supply',
        params: { token: intent.fromToken ?? 'ETH', amount: intent.amount ?? '0' },
        estimatedCost: baseGas * 2n,
      });
      break;

    case 'borrow':
      steps.push(
        {
          protocol,
          action: 'enableCollateral',
          params: { token: intent.fromToken ?? 'WBTC' },
          estimatedCost: baseGas,
        },
        {
          protocol,
          action: 'borrow',
          params: { token: intent.toToken ?? 'USDC', amount: intent.amount ?? '0' },
          estimatedCost: baseGas * 2n,
        },
      );
      break;

    case 'stake':
      steps.push({
        protocol,
        action: 'stake',
        params: { token: intent.fromToken ?? 'ETH', amount: intent.amount ?? '0' },
        estimatedCost: baseGas * 2n,
      });
      break;

    case 'bridge':
      steps.push(
        {
          protocol,
          action: 'approve',
          params: { token: intent.fromToken ?? 'ETH', amount: intent.amount ?? '0' },
          estimatedCost: baseGas,
        },
        {
          protocol,
          action: 'bridge',
          params: {
            fromToken: intent.fromToken ?? 'ETH',
            toChain: intent.toToken ?? 'arbitrum',
            amount: intent.amount ?? '0',
          },
          estimatedCost: baseGas * 4n,
        },
      );
      break;

    default:
      steps.push({
        protocol: 'unknown',
        action: 'noop',
        params: {},
        estimatedCost: 0n,
      });
  }

  const estimatedCost = steps.reduce((acc, s) => acc + s.estimatedCost, 0n);

  return { steps, estimatedCost, protocols, intent };
}
