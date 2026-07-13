/**
 * ghost-program.test.ts — Tests for the Ghost AI on-chain inference program.
 *
 * Unit tests always run (pure logic / constant checks).
 * Integration tests skip when Octra mainnet is unreachable.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  GHOST_PROGRAM_SOURCE,
  ghostCompileProgram,
  ghostDeployProgram,
  ghostCompileAndDeploy,
} from '../src/ghost-program.js';
import { Circle } from '../src/circle.js';
import { probeNode, getRpcMode, _resetProbeState } from '../src/octra-rpc.js';
import { generatePQCKeypair } from '@noisebound/pqc-wallet';

let nodeReachable = false;

beforeAll(async () => {
  _resetProbeState();
  const mode = await probeNode();
  nodeReachable = mode === 'real';
}, 20_000);

// ─── Unit: GHOST_PROGRAM_SOURCE ───────────────────────────────────────────────

describe('GHOST_PROGRAM_SOURCE', () => {
  it('is a non-empty string', () => {
    expect(typeof GHOST_PROGRAM_SOURCE).toBe('string');
    expect(GHOST_PROGRAM_SOURCE.length).toBeGreaterThan(0);
  });

  it('defines a GhostInference contract', () => {
    expect(GHOST_PROGRAM_SOURCE).toContain('contract GhostInference');
  });

  it('declares ghost_predict function', () => {
    expect(GHOST_PROGRAM_SOURCE).toContain('fn ghost_predict');
  });

  it('ghost_predict accepts pk_addr, ct0, ct1 string parameters', () => {
    expect(GHOST_PROGRAM_SOURCE).toContain('pk_addr: string, ct0: string, ct1: string');
  });

  it('ghost_predict returns serialized ciphertext via fhe_ser', () => {
    expect(GHOST_PROGRAM_SOURCE).toContain('return fhe_ser(result)');
  });

  it('declares query_count via get_query_count view function', () => {
    expect(GHOST_PROGRAM_SOURCE).toContain('query_count');
  });

  it('declares owner address state field', () => {
    expect(GHOST_PROGRAM_SOURCE).toContain('owner: address');
  });

  it('declares total_queries state field', () => {
    expect(GHOST_PROGRAM_SOURCE).toContain('total_queries: int');
  });

  it('declares set_weights function', () => {
    expect(GHOST_PROGRAM_SOURCE).toContain('fn set_weights');
  });

  it('declares get_query_count view function', () => {
    expect(GHOST_PROGRAM_SOURCE).toContain('fn get_query_count');
  });

  it('uses public view fn syntax for read-only functions', () => {
    expect(GHOST_PROGRAM_SOURCE).toContain('public view fn ghost_predict');
  });

  it('uses public fn syntax for state-mutating functions', () => {
    expect(GHOST_PROGRAM_SOURCE).toContain('public fn set_weights');
  });

  it('constructor has no arguments', () => {
    expect(GHOST_PROGRAM_SOURCE).toContain('constructor()');
  });

  it('constructor sets owner to origin', () => {
    expect(GHOST_PROGRAM_SOURCE).toContain('self.owner = origin');
  });

  it('includes fhe_load_pk primitive', () => {
    expect(GHOST_PROGRAM_SOURCE).toContain('fhe_load_pk(');
  });

  it('includes fhe_deser primitive', () => {
    expect(GHOST_PROGRAM_SOURCE).toContain('fhe_deser(');
  });

  it('includes fhe_scale primitive', () => {
    expect(GHOST_PROGRAM_SOURCE).toContain('fhe_scale(');
  });

  it('includes fhe_add primitive', () => {
    expect(GHOST_PROGRAM_SOURCE).toContain('fhe_add(pk,');
  });

  it('includes fhe_add_const primitive', () => {
    expect(GHOST_PROGRAM_SOURCE).toContain('fhe_add_const(');
  });

  it('includes fhe_ser primitive', () => {
    expect(GHOST_PROGRAM_SOURCE).toContain('fhe_ser(');
  });

  it('includes parse_ints primitive for CSV weight loading', () => {
    expect(GHOST_PROGRAM_SOURCE).toContain('parse_ints(');
  });

  it('includes mget primitive for memory access', () => {
    expect(GHOST_PROGRAM_SOURCE).toContain('mget(');
  });

  it('declares ghost_predict_multi for multi-feature inference', () => {
    expect(GHOST_PROGRAM_SOURCE).toContain('fn ghost_predict_multi');
  });

  it('ghost_predict_multi accepts pk_addr, cts, n parameters', () => {
    expect(GHOST_PROGRAM_SOURCE).toContain('ghost_predict_multi(pk_addr: string, cts: string, n: int)');
  });

  it('declares set_bias function', () => {
    expect(GHOST_PROGRAM_SOURCE).toContain('fn set_bias');
  });

  it('declares log_query function', () => {
    expect(GHOST_PROGRAM_SOURCE).toContain('fn log_query');
  });

  it('declares get_owner view function', () => {
    expect(GHOST_PROGRAM_SOURCE).toContain('fn get_owner');
  });

  it('declares get_num_features view function', () => {
    expect(GHOST_PROGRAM_SOURCE).toContain('fn get_num_features');
  });

  it('requires caller to be owner in set_weights', () => {
    expect(GHOST_PROGRAM_SOURCE).toContain('require(caller == self.owner');
  });

  it('declares num_features state field', () => {
    expect(GHOST_PROGRAM_SOURCE).toContain('num_features: int');
  });

  it('declares weights as map[int]int', () => {
    expect(GHOST_PROGRAM_SOURCE).toContain('weights: map[int]int');
  });

  it('declares bias state field', () => {
    expect(GHOST_PROGRAM_SOURCE).toContain('bias: int');
  });
});

// ─── Unit: ghostCompileProgram ────────────────────────────────────────────────

describe('ghostCompileProgram', () => {
  it('returns a GhostProgram with source, codeB64, compiledOnChain', async () => {
    const program = await ghostCompileProgram();
    expect(typeof program.source).toBe('string');
    expect(typeof program.codeB64).toBe('string');
    expect(typeof program.compiledOnChain).toBe('boolean');
  }, 15_000);

  it('source matches GHOST_PROGRAM_SOURCE by default', async () => {
    const program = await ghostCompileProgram();
    expect(program.source).toBe(GHOST_PROGRAM_SOURCE);
  }, 15_000);

  it('codeB64 is a valid base64 string', async () => {
    const program = await ghostCompileProgram();
    expect(/^[A-Za-z0-9+/=]+$/.test(program.codeB64)).toBe(true);
  }, 15_000);

  it('accepts a custom AML source string', async () => {
    const custom = 'contract TestGhost { state {} constructor() {} }';
    const program = await ghostCompileProgram(custom);
    expect(program.source).toBe(custom);
    expect(program.codeB64.length).toBeGreaterThan(0);
  }, 15_000);

  it('compiledOnChain is false when node is unreachable (mock mode)', async () => {
    if (nodeReachable) return;
    const program = await ghostCompileProgram();
    expect(program.compiledOnChain).toBe(false);
  }, 15_000);

  it('compiledOnChain is true in real mode', async () => {
    if (!nodeReachable) return;
    const program = await ghostCompileProgram();
    expect(program.compiledOnChain).toBe(true);
  }, 30_000);
});

// ─── Unit: ghostDeployProgram ─────────────────────────────────────────────────

describe('ghostDeployProgram', () => {
  it('returns a GhostCircleDeployment with all required fields', async () => {
    const keypair = generatePQCKeypair();
    const program = await ghostCompileProgram();
    const deployment = await ghostDeployProgram(keypair, program);

    expect(typeof deployment.circleId).toBe('string');
    expect(typeof deployment.txHash).toBe('string');
    expect(deployment.circle).toBeInstanceOf(Circle);
    expect(typeof deployment.deployedOnChain).toBe('boolean');
    expect(typeof deployment.deployedAt).toBe('number');
  }, 20_000);

  it('circleId starts with "oct"', async () => {
    const keypair = generatePQCKeypair();
    const program = await ghostCompileProgram();
    const deployment = await ghostDeployProgram(keypair, program);
    expect(deployment.circleId.startsWith('oct')).toBe(true);
  }, 20_000);

  it('txHash is a non-empty string', async () => {
    const keypair = generatePQCKeypair();
    const program = await ghostCompileProgram();
    const deployment = await ghostDeployProgram(keypair, program);
    expect(deployment.txHash.length).toBeGreaterThan(0);
  }, 20_000);

  it('circle.address matches the circleId', async () => {
    const keypair = generatePQCKeypair();
    const program = await ghostCompileProgram();
    const deployment = await ghostDeployProgram(keypair, program);
    expect(deployment.circle.address).toBe(deployment.circleId);
  }, 20_000);

  it('deployedAt is a recent timestamp', async () => {
    const before = Date.now();
    const keypair = generatePQCKeypair();
    const program = await ghostCompileProgram();
    const deployment = await ghostDeployProgram(keypair, program);
    expect(deployment.deployedAt).toBeGreaterThanOrEqual(before);
    expect(deployment.deployedAt).toBeLessThanOrEqual(Date.now() + 1000);
  }, 20_000);

  it('deployedOnChain is false in mock mode', async () => {
    if (nodeReachable) return;
    const keypair = generatePQCKeypair();
    const program = await ghostCompileProgram();
    const deployment = await ghostDeployProgram(keypair, program);
    expect(deployment.deployedOnChain).toBe(false);
  }, 20_000);

  it('different keypairs produce different circleIds', async () => {
    const kp1 = generatePQCKeypair();
    const kp2 = generatePQCKeypair();
    const program = await ghostCompileProgram();
    const d1 = await ghostDeployProgram(kp1, program);
    const d2 = await ghostDeployProgram(kp2, program);
    expect(d1.circleId).not.toBe(d2.circleId);
  }, 30_000);
});

// ─── Unit: ghostCompileAndDeploy (convenience) ───────────────────────────────

describe('ghostCompileAndDeploy', () => {
  it('returns a GhostCircleDeployment with a Circle handle', async () => {
    const keypair = generatePQCKeypair();
    const deployment = await ghostCompileAndDeploy(keypair);
    expect(deployment.circle).toBeInstanceOf(Circle);
    expect(deployment.circleId.startsWith('oct')).toBe(true);
  }, 30_000);

  it('accepts a custom AML source', async () => {
    const keypair = generatePQCKeypair();
    const custom = 'contract CustomGhost { state {} constructor() {} }';
    const deployment = await ghostCompileAndDeploy(keypair, custom);
    expect(deployment.circleId.startsWith('oct')).toBe(true);
  }, 30_000);
});

// ─── Integration: real compile RPC ────────────────────────────────────────────

describe('Octra compile integration', () => {
  it.skipIf(!nodeReachable)(
    'ghostCompileProgram returns compiledOnChain=true with real node',
    async () => {
      const program = await ghostCompileProgram();
      expect(program.compiledOnChain).toBe(true);
      expect(program.codeB64.length).toBeGreaterThan(0);
    },
    30_000,
  );

  it.skipIf(!nodeReachable)(
    'ghostDeployProgram returns deployedOnChain=true with real node',
    async () => {
      const keypair = generatePQCKeypair();
      const program = await ghostCompileProgram();
      const deployment = await ghostDeployProgram(keypair, program);
      expect(deployment.deployedOnChain).toBe(true);
      expect(deployment.txHash.startsWith('0xmock')).toBe(false);
    },
    60_000,
  );
});
