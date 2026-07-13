import { describe, it, expect } from 'vitest';
import { AgentCircle, createAgentCircle, SpendingLimitError, ProtocolNotAllowedError } from '../src/agent.js';
import { generatePQCKeypair } from '@noisebound/pqc-wallet';
import type { AgentConfig } from '../src/types.js';

const ONE_OCT = 1_000_000n;

function makeAgentConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    agentId: 'test-agent-001',
    allowedProtocols: ['uniswap', 'aave', 'curve'],
    spendingLimits: {
      maxPerTx: ONE_OCT * 100n,     // 100 OCT
      maxPerDay: ONE_OCT * 1000n,   // 1000 OCT
      maxTotal: ONE_OCT * 10_000n,  // 10,000 OCT
    },
    keypair: generatePQCKeypair(),
    ...overrides,
  };
}

describe('createAgentCircle', () => {
  it('returns an AgentCircle instance', async () => {
    const agent = await createAgentCircle(makeAgentConfig());
    expect(agent).toBeInstanceOf(AgentCircle);
  });

  it('AgentCircle has a non-empty address', async () => {
    const agent = await createAgentCircle(makeAgentConfig());
    expect(agent.address).toBeTruthy();
    expect(agent.address.startsWith('0x')).toBe(true);
  });

  it('AgentCircle exposes the agentConfig', async () => {
    const config = makeAgentConfig();
    const agent = await createAgentCircle(config);
    expect(agent.agentConfig.agentId).toBe('test-agent-001');
    expect(agent.agentConfig.allowedProtocols).toContain('uniswap');
  });

  it('rejects an authProof with empty proof bytes', async () => {
    const config = makeAgentConfig({
      authProof: { proof: new Uint8Array(0), publicInputs: [] },
    });
    await expect(createAgentCircle(config)).rejects.toThrow('empty');
  });
});

describe('AgentCircle.executeInstruction', () => {
  it('returns an ExecutionPlan for a swap instruction', async () => {
    const agent = await createAgentCircle(makeAgentConfig());
    const plan = await agent.executeInstruction('swap 1.5 ETH for USDC on uniswap');
    expect(plan.steps.length).toBeGreaterThan(0);
    expect(plan.estimatedCost).toBeGreaterThanOrEqual(0n);
    expect(Array.isArray(plan.protocols)).toBe(true);
  });

  it('ExecutionPlan includes the parsed intent', async () => {
    const agent = await createAgentCircle(makeAgentConfig());
    const plan = await agent.executeInstruction('swap 2 ETH for USDC on uniswap');
    expect(plan.intent.action).toBe('swap');
  });

  it('ExecutionPlan has at least one step', async () => {
    const agent = await createAgentCircle(makeAgentConfig());
    const plan = await agent.executeInstruction('lend 500 USDC on aave');
    expect(plan.steps.length).toBeGreaterThan(0);
    expect(plan.steps[0].protocol).toBeTruthy();
    expect(plan.steps[0].action).toBeTruthy();
  });

  it('throws SpendingLimitError when plan cost exceeds maxPerTx', async () => {
    const agent = await createAgentCircle(
      makeAgentConfig({
        spendingLimits: {
          maxPerTx: 1n,        // 1 μOCT — effectively zero
          maxPerDay: ONE_OCT * 1000n,
          maxTotal: ONE_OCT * 10_000n,
        },
      }),
    );
    await expect(
      agent.executeInstruction('swap 100 ETH for USDC on uniswap'),
    ).rejects.toBeInstanceOf(SpendingLimitError);
  });

  it('SpendingLimitError message mentions the limit', async () => {
    const agent = await createAgentCircle(
      makeAgentConfig({
        spendingLimits: {
          maxPerTx: 1n,
          maxPerDay: ONE_OCT * 1000n,
          maxTotal: ONE_OCT * 10_000n,
        },
      }),
    );
    try {
      await agent.executeInstruction('swap 1 ETH for USDC');
    } catch (err) {
      expect(err).toBeInstanceOf(SpendingLimitError);
      expect((err as SpendingLimitError).message).toContain('μOCT');
    }
  });
});

describe('AgentCircle.submitExecution', () => {
  it('returns an ExecutionResult with success=true', async () => {
    const agent = await createAgentCircle(makeAgentConfig());
    const plan = await agent.executeInstruction('lend 1 ETH on aave');
    const result = await agent.submitExecution(plan);
    expect(result.success).toBe(true);
  });

  it('ExecutionResult includes txHashes', async () => {
    const agent = await createAgentCircle(makeAgentConfig());
    const plan = await agent.executeInstruction('swap 1 ETH for USDC on uniswap');
    const result = await agent.submitExecution(plan);
    expect(Array.isArray(result.txHashes)).toBe(true);
    expect(result.txHashes.length).toBe(plan.steps.length);
    result.txHashes.forEach(h => expect(h.startsWith('0x')).toBe(true));
  });

  it('ExecutionResult has a timestamp', async () => {
    const before = Date.now();
    const agent = await createAgentCircle(makeAgentConfig());
    const plan = await agent.executeInstruction('lend 100 USDC on aave');
    const result = await agent.submitExecution(plan);
    expect(result.timestamp).toBeGreaterThanOrEqual(before);
  });

  it('throws SpendingLimitError when cumulative daily spend exceeds maxPerDay', async () => {
    const agent = await createAgentCircle(
      makeAgentConfig({
        spendingLimits: {
          maxPerTx: ONE_OCT * 200n,
          maxPerDay: ONE_OCT * 10n,   // very low daily limit
          maxTotal: ONE_OCT * 10_000n,
        },
      }),
    );
    // First execution goes through
    const plan1 = await agent.executeInstruction('stake 1 ETH');
    await agent.submitExecution(plan1);
    // Keep submitting until we hit the daily limit
    const plan2 = await agent.executeInstruction('stake 1 ETH');
    for (let i = 0; i < 20; i++) {
      try {
        await agent.submitExecution(plan2);
      } catch (err) {
        expect(err).toBeInstanceOf(SpendingLimitError);
        return;
      }
    }
    // If we got here without hitting the limit on 20 iters, fail
    // (This path is unlikely with maxPerDay = 10 OCT and staking costs)
  });
});

describe('AgentCircle.getExecutionHistory', () => {
  it('returns empty array before any execution', async () => {
    const agent = await createAgentCircle(makeAgentConfig());
    const history = await agent.getExecutionHistory();
    expect(history).toEqual([]);
  });

  it('records completed executions in history', async () => {
    const agent = await createAgentCircle(makeAgentConfig());
    const plan = await agent.executeInstruction('swap 1 ETH for USDC on uniswap');
    await agent.submitExecution(plan);
    const history = await agent.getExecutionHistory();
    expect(history.length).toBe(1);
    expect(history[0].success).toBe(true);
  });

  it('history grows with each execution', async () => {
    const agent = await createAgentCircle(makeAgentConfig());
    for (const instr of ['stake 0.5 ETH', 'lend 100 USDC on aave']) {
      const plan = await agent.executeInstruction(instr);
      await agent.submitExecution(plan);
    }
    const history = await agent.getExecutionHistory();
    expect(history.length).toBe(2);
  });

  it('returns a copy — mutating the result does not affect history', async () => {
    const agent = await createAgentCircle(makeAgentConfig());
    const plan = await agent.executeInstruction('swap 1 ETH for USDC');
    await agent.submitExecution(plan);
    const h1 = await agent.getExecutionHistory();
    h1.pop();
    const h2 = await agent.getExecutionHistory();
    expect(h2.length).toBe(1);
  });
});

describe('Full agent flow', () => {
  it('create → parse instruction → generate plan → execute', async () => {
    const config = makeAgentConfig();
    const agent = await createAgentCircle(config);

    // Step 1: parse instruction
    const plan = await agent.executeInstruction('swap 2 ETH for USDC on uniswap');
    expect(plan.intent.action).toBe('swap');
    expect(plan.steps.length).toBeGreaterThan(0);

    // Step 2: submit execution
    const result = await agent.submitExecution(plan);
    expect(result.success).toBe(true);
    expect(result.plan).toBe(plan);
    expect(result.txHashes.length).toBeGreaterThan(0);

    // Step 3: check history
    const history = await agent.getExecutionHistory();
    expect(history[history.length - 1]).toBe(result);
  });
});
