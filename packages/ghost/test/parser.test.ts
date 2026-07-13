import { describe, it, expect } from 'vitest';
import { IntentParser } from '../src/parser/IntentParser.js';
import type { GhostAction } from '../src/parser/types.js';

const parser = new IntentParser();

describe('IntentParser — action classification', () => {
  it('parses swap', () => {
    expect(parser.parse('swap 2 ETH for USDC').action).toBe('swap');
  });
  it('parses send', () => {
    expect(parser.parse('send 100 USDC to 0x1234567890123456789012345678901234567890').action).toBe('send');
  });
  it('parses earn', () => {
    expect(parser.parse('I want to earn yield on my USDC').action).toBe('earn');
  });
  it('parses stake', () => {
    expect(parser.parse('stake my ETH').action).toBe('stake');
  });
  it('parses borrow and requires reasoning', () => {
    const intent = parser.parse('borrow USDC against my ETH collateral');
    expect(intent.action).toBe('borrow');
    expect(intent.requiresReasoning).toBe(true);
  });
  it('parses repay', () => {
    expect(parser.parse('repay my USDC loan').action).toBe('repay');
  });
  it('parses provide_liquidity and requires reasoning', () => {
    const intent = parser.parse('provide liquidity to the ETH/USDC pool');
    expect(intent.action).toBe('provide_liquidity');
    expect(intent.requiresReasoning).toBe(true);
  });
  it('parses remove_liquidity and requires reasoning', () => {
    const intent = parser.parse('remove my liquidity from the pool');
    expect(intent.action).toBe('remove_liquidity');
    expect(intent.requiresReasoning).toBe(true);
  });
  it('parses bridge and requires reasoning', () => {
    const intent = parser.parse('bridge my ETH to Base');
    expect(intent.action).toBe('bridge');
    expect(intent.requiresReasoning).toBe(true);
  });
  it('parses approve', () => {
    expect(parser.parse('approve USDC spending for Uniswap').action).toBe('approve');
  });
  it('parses query balance', () => {
    const intent = parser.parse('what is my balance');
    expect(intent.action).toBe('query');
    expect(intent.params.queryType).toBe('balance');
  });
  it('parses query history', () => {
    const intent = parser.parse('show me my transaction history');
    expect(intent.action).toBe('query');
    expect(intent.params.queryType).toBe('history');
  });
  it('parses query price', () => {
    const intent = parser.parse('what is the current price of ETH');
    expect(intent.action).toBe('query');
    expect(intent.params.queryType).toBe('price');
  });
  it('parses complex when a protocol and a constraint are both present', () => {
    const intent = parser.parse('Buy ETH on uniswap only if gas is under $5');
    expect(intent.action).toBe('complex');
    expect(intent.requiresReasoning).toBe(true);
  });
});

describe('IntentParser — clarify fallback', () => {
  it('returns clarify for empty input', () => {
    const intent = parser.parse('');
    expect(intent.action).toBe('clarify');
    expect(intent.ghostResponse).toContain('Sovereign');
  });
  it('returns clarify for unrecognized input', () => {
    const intent = parser.parse('do the thing with my money');
    expect(intent.action).toBe('clarify');
  });
});

describe('IntentParser — parameter extraction', () => {
  it('extracts a fixed amount', () => {
    expect(parser.parse('swap 12.5 ETH for USDC').params.amount).toBe('12.5');
  });
  it('extracts a percentage amount', () => {
    const intent = parser.parse('swap 25% of my ETH for USDC');
    expect(intent.params.amount).toBe('25');
    expect(intent.params.amountIsPercent).toBe(true);
  });
  it('treats "half" as a 50% amount', () => {
    const intent = parser.parse('swap half my ETH for USDC');
    expect(intent.params.amount).toBe('50');
    expect(intent.params.amountIsPercent).toBe(true);
  });
  it('treats "all" as a 100% amount', () => {
    const intent = parser.parse('swap all my ETH for USDC');
    expect(intent.params.amount).toBe('100');
    expect(intent.params.amountIsPercent).toBe(true);
  });
  it('extracts fromToken/toToken from messy natural language', () => {
    const intent = parser.parse('hey can you exchange like 3 weth for some usdc please');
    expect(intent.params.fromToken).toBe('WETH');
    expect(intent.params.toToken).toBe('USDC');
  });
  it('extracts a known protocol name', () => {
    expect(parser.parse('borrow against my ETH on aave').params.protocol).toBe('aave');
  });
  it('extracts a free-text constraint', () => {
    const intent = parser.parse('borrow USDC against ETH, no more than 10% interest');
    expect(intent.params.constraint?.toLowerCase()).toContain('no more than 10%');
  });
});

describe('IntentParser — Ghost voice', () => {
  const ACTIONS: GhostAction[] = [
    'swap', 'send', 'earn', 'stake', 'borrow', 'repay',
    'provide_liquidity', 'remove_liquidity', 'bridge', 'approve', 'query', 'complex',
  ];
  const SAMPLE_INPUTS: Record<GhostAction, string> = {
    swap: 'swap 1 ETH for USDC',
    send: 'send 5 USDC to 0x1234567890123456789012345678901234567890',
    earn: 'earn yield on my USDC',
    stake: 'stake 1 ETH',
    borrow: 'borrow USDC against ETH',
    repay: 'repay my loan',
    provide_liquidity: 'add liquidity to the ETH/USDC pool',
    remove_liquidity: 'remove liquidity from the pool',
    bridge: 'bridge ETH to Base',
    approve: 'approve USDC spending',
    query: 'what is my balance',
    complex: 'swap on uniswap only if gas is under $5',
    clarify: '',
  };

  it('always addresses the user as Sovereign', () => {
    for (const action of ACTIONS) {
      const intent = parser.parse(SAMPLE_INPUTS[action]);
      expect(intent.ghostResponse).toContain('Sovereign');
    }
  });

  it('flags requiresReasoning for borrow, liquidity, bridge, and complex intents only', () => {
    const reasoningActions: GhostAction[] = ['borrow', 'provide_liquidity', 'remove_liquidity', 'bridge', 'complex'];
    for (const action of ACTIONS) {
      const intent = parser.parse(SAMPLE_INPUTS[action]);
      expect(intent.requiresReasoning).toBe(reasoningActions.includes(action));
    }
  });

  it('does not crash on typos or abbreviated input', () => {
    expect(() => parser.parse('swp eth->usdc plz')).not.toThrow();
    expect(() => parser.parse('brrw usdc')).not.toThrow();
  });

  it('handles voice-style conversational input', () => {
    const intent = parser.parse('hey ghost, could you please send 10 usdc over to 0x1234567890123456789012345678901234567890 for me');
    expect(intent.action).toBe('send');
    expect(intent.params.amount).toBe('10');
  });
});
