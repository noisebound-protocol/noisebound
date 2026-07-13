import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('node-fetch', () => ({
  default: vi.fn().mockRejectedValue(new Error('network disabled in tests')),
}));

vi.mock('@noisebound/circles', async () => {
  const actual = await vi.importActual<typeof import('@noisebound/circles')>('@noisebound/circles');
  class MockCircleSession {
    async create(): Promise<void> {}
    async encryptQuery(prompt: string): Promise<Uint8Array> {
      return new TextEncoder().encode(`ct:${prompt}`);
    }
    async teardown(): Promise<void> {}
    get ghostCircleId(): string {
      return 'mock-circle-id';
    }
    get circle(): undefined {
      return undefined;
    }
  }
  return { ...actual, CircleSession: MockCircleSession };
});

import { Ghost } from '../src/Ghost.js';
import { DeFiReasoner } from '../src/reasoning/DeFiReasoner.js';
import { GhostTrainer } from '../src/training/GhostTrainer.js';
import type { UserContext } from '../src/parser/types.js';

afterEach(() => {
  vi.restoreAllMocks();
});

function context(balances: Record<string, string>): UserContext {
  return { address: '0x1234567890123456789012345678901234567890', network: 'base-sepolia', balances };
}

describe('Ghost.execute', () => {
  it('does not invoke the reasoning layer for a simple swap intent', async () => {
    const reasonSpy = vi.spyOn(DeFiReasoner.prototype, 'reason');
    const ghost = new Ghost({ network: 'base-sepolia', enableTraining: false });
    const result = await ghost.execute('swap 1 ETH for USDC', context({ ETH: '5' }));
    expect(reasonSpy).not.toHaveBeenCalled();
    expect(result.plan).toBeUndefined();
    expect(result.intent.action).toBe('swap');
  });

  it('invokes the reasoning layer for a complex borrow intent', async () => {
    const reasonSpy = vi.spyOn(DeFiReasoner.prototype, 'reason');
    const ghost = new Ghost({ network: 'base-sepolia', enableTraining: false });
    const result = await ghost.execute('borrow USDC against my ETH, no more than 8% interest', context({ ETH: '5' }));
    expect(reasonSpy).toHaveBeenCalledTimes(1);
    expect(result.plan).toBeDefined();
  });

  it('collects a training pair after a successful execution', async () => {
    const collectSpy = vi.spyOn(GhostTrainer.prototype, 'collectTrainingPair').mockResolvedValue(undefined);
    const ghost = new Ghost({ network: 'base-sepolia' });
    await ghost.execute('swap 1 ETH for USDC', context({ ETH: '5' }));
    expect(collectSpy).toHaveBeenCalledTimes(1);
    expect(collectSpy.mock.calls[0][0]).toBe('swap 1 ETH for USDC');
  });

  it('does not collect a training pair when enableTraining is false', async () => {
    const collectSpy = vi.spyOn(GhostTrainer.prototype, 'collectTrainingPair').mockResolvedValue(undefined);
    const ghost = new Ghost({ network: 'base-sepolia', enableTraining: false });
    await ghost.execute('swap 1 ETH for USDC', context({ ETH: '5' }));
    expect(collectSpy).not.toHaveBeenCalled();
  });

  it('flags requiresClarification and executionReady=false for unclear input', async () => {
    const ghost = new Ghost({ network: 'base-sepolia', enableTraining: false });
    const result = await ghost.execute('do the thing with my money', context({ USDC: '100' }));
    expect(result.requiresClarification).toBe(true);
    expect(result.executionReady).toBe(false);
  });

  it('always addresses the user as Sovereign in the response', async () => {
    const ghost = new Ghost({ network: 'base-sepolia', enableTraining: false });
    const result = await ghost.execute('borrow USDC against my ETH', context({ ETH: '5' }));
    expect(result.ghostResponse).toContain('Sovereign');
  });
});

describe('Ghost.stream', () => {
  it('yields the ghost response as a single chunk for a non-clarify intent', async () => {
    const ghost = new Ghost({ network: 'base-sepolia', enableTraining: false });
    const chunks: string[] = [];
    for await (const chunk of ghost.stream('swap 1 ETH for USDC', context({ ETH: '5' }))) {
      chunks.push(chunk);
    }
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.join('').length).toBeGreaterThan(0);
  });

  it('yields at least one chunk for a clarify intent with mocked llmClient', async () => {
    async function* mockStream() { yield 'Hello'; yield ', Sovereign.'; }
    const llmClient = {
      chat: vi.fn().mockResolvedValue('Hello, Sovereign.'),
      stream: vi.fn().mockReturnValue(mockStream()),
    };
    const ghost = new Ghost({
      network: 'base-sepolia',
      enableTraining: false,
      llmClient: llmClient as any,
    });
    const chunks: string[] = [];
    for await (const chunk of ghost.stream('do the thing with my money', context({ USDC: '100' }))) {
      chunks.push(chunk);
    }
    expect(chunks.length).toBeGreaterThan(0);
    expect(llmClient.stream).toHaveBeenCalledTimes(1);
  });
});

describe('Ghost.sign', () => {
  it('returns one txHash per execution step', async () => {
    const ghost = new Ghost({ network: 'base-sepolia', enableTraining: false });
    const result = await ghost.execute('borrow USDC against my ETH', context({ ETH: '5' }));
    const signResult = await ghost.sign(result.plan!, context({ ETH: '5' }));
    expect(signResult.success).toBe(true);
    expect(signResult.txHashes).toHaveLength(result.plan!.steps.length);
    for (const hash of signResult.txHashes) {
      expect(hash).toMatch(/^0x[0-9a-f]+$/);
    }
  });

  it('reports the signing outcome back to the trainer', async () => {
    const collectSpy = vi.spyOn(GhostTrainer.prototype, 'collectTrainingPair').mockResolvedValue(undefined);
    const ghost = new Ghost({ network: 'base-sepolia' });
    const result = await ghost.execute('borrow USDC against my ETH', context({ ETH: '5' }));
    collectSpy.mockClear();
    const signResult = await ghost.sign(result.plan!, context({ ETH: '5' }));
    expect(collectSpy).toHaveBeenCalledTimes(1);
    expect(collectSpy.mock.calls[0][2]).toBe('success');
    expect(collectSpy.mock.calls[0][3]).toBe(signResult.txHashes[0]);
  });
});
