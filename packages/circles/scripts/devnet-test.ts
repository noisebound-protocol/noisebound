/**
 * devnet-test.ts — Octra devnet integration test for deploy_circle signing.
 *
 * Tests the corrected tx structure against devnet before any mainnet attempt:
 *   Corrected: signFields = { from, to_, amount, nonce, ou, timestamp } (signed)
 *              payload (circle resource budget) OUTSIDE the signing blob
 *   Old:       full txBody including payload and op_type inside signing blob
 *
 * Open unknowns being answered:
 *   Q1: Is `to_` (with underscore) the correct field name? What value for deploy_circle?
 *   Q2: Is payload correctly placed OUTSIDE the signing blob?
 *
 * Run (PowerShell):
 *   cd packages/circles
 *   $env:GHOST_OCTRA_DEVNET='1'; npx tsx scripts/devnet-test.ts
 *
 * The script generates a fresh devnet keypair if GHOST_OCTRA_DEVNET_KEY_HEX is unset.
 * NEVER use Ghost's real mainnet key here — devnet keys are valueless and separate.
 */

import { createPrivateKey, createPublicKey, randomBytes, sign as cryptoSign } from 'crypto';
import axios from 'axios';

// ─── Config ───────────────────────────────────────────────────────────────────

const DEVNET_URL = process.env['GHOST_OCTRA_DEVNET_URL'] ?? 'https://devnet.octra.com/rpc';
const TIMEOUT_MS = 10_000;

// ─── Ed25519 helpers ──────────────────────────────────────────────────────────

const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const ED25519_SPKI_PUB_OFFSET = 12;

function derivePubkeyBytes(seedHex: string): Buffer {
  const seed = Buffer.from(seedHex, 'hex');
  const pkcs8 = Buffer.concat([ED25519_PKCS8_PREFIX, seed]);
  const privKey = createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' });
  const spki = createPublicKey(privKey).export({ type: 'spki', format: 'der' }) as Buffer;
  return spki.slice(ED25519_SPKI_PUB_OFFSET);
}

function ed25519Sign(fields: Record<string, unknown>, seedHex: string): { signature: string; public_key: string } {
  const seed = Buffer.from(seedHex, 'hex');
  const pkcs8 = Buffer.concat([ED25519_PKCS8_PREFIX, seed]);
  const privKey = createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' });
  const spki = createPublicKey(privKey).export({ type: 'spki', format: 'der' }) as Buffer;
  const rawPub = spki.slice(ED25519_SPKI_PUB_OFFSET);
  const msg = Buffer.from(JSON.stringify(fields), 'utf8');
  const sig = cryptoSign(null, msg, privKey);
  return { signature: sig.toString('base64'), public_key: rawPub.toString('base64') };
}

// ─── Base58 ───────────────────────────────────────────────────────────────────

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function toBase58(bytes: Uint8Array): string {
  let num = 0n;
  for (const b of bytes) num = num * 256n + BigInt(b);
  let result = '';
  while (num > 0n) { result = BASE58[Number(num % 58n)] + result; num = num / 58n; }
  for (const b of bytes) { if (b !== 0) break; result = '1' + result; }
  return result;
}

/** Best-guess Octra address: "oct" + base58(raw_ed25519_pubkey_32_bytes) */
function octraAddress(pubkeyBytes: Buffer): string {
  return 'oct' + toBase58(pubkeyBytes);
}

// ─── JSON-RPC 2.0 ─────────────────────────────────────────────────────────────

const http = axios.create({ headers: { 'Content-Type': 'application/json', 'User-Agent': 'Veil-Ghost/1.0' } });
let rpcId = 1;

interface RpcError extends Error { rpcCode: number; rpcMessage: string }

async function rpc(method: string, params: unknown[]): Promise<unknown> {
  const id = rpcId++;
  try {
    const res = await http.post<{ result?: unknown; error?: { code: number; message: string } }>(
      DEVNET_URL,
      { jsonrpc: '2.0', id, method, params },
      { timeout: TIMEOUT_MS },
    );
    if (res.data.error) {
      const err = Object.assign(new Error(`${res.data.error.code}: ${res.data.error.message}`), {
        rpcCode: res.data.error.code,
        rpcMessage: res.data.error.message,
      }) as RpcError;
      throw err;
    }
    return res.data.result ?? null;
  } catch (err) {
    if ((err as RpcError).rpcCode !== undefined) throw err;
    const wrapped = Object.assign(new Error(`HTTP/network error: ${String(err)}`), {
      rpcCode: -1,
      rpcMessage: String(err),
    }) as RpcError;
    throw wrapped;
  }
}

// ─── Deploy payload ───────────────────────────────────────────────────────────

const DEPLOY_PAYLOAD = {
  runtime: 'octb',
  privacy_class: 'sealed',
  browser_mode: 'native_sealed',
  resource_mode: 'sealed_read',
  code_b64: null,
  policy_hash: null,
  members_root: null,
  export_policy: null,
  limits: {
    max_stable_bytes: '33554432',
    max_assets_bytes: '33554432',
    max_inline_value: '65536',
    max_wasm_bytes: '33554432',
  },
};

// ─── Main ─────────────────────────────────────────────────────────────────────

function sep() { console.log('─'.repeat(62)); }

async function main() {
  console.log('═'.repeat(62));
  console.log('Octra devnet deploy_circle signing test');
  console.log(`Target: ${DEVNET_URL}`);
  console.log('═'.repeat(62));

  // Keypair
  const seedHex = process.env['GHOST_OCTRA_DEVNET_KEY_HEX'] ?? randomBytes(32).toString('hex');
  const isGenerated = !process.env['GHOST_OCTRA_DEVNET_KEY_HEX'];
  const pubkeyBytes = derivePubkeyBytes(seedHex);
  const address = octraAddress(pubkeyBytes);

  console.log('\n[keypair]');
  if (isGenerated) {
    console.log('  Generated fresh devnet-only keypair');
    console.log(`  Seed hex (save for re-runs): ${seedHex}`);
  }
  console.log(`  Public key (base64): ${pubkeyBytes.toString('base64')}`);
  console.log(`  Address (best-guess oct+base58): ${address}`);

  // Step 1: probe
  sep();
  console.log('[step 1] node_status');
  try {
    const status = await rpc('node_status', []);
    console.log('  ✓ Devnet reachable');
    const preview = JSON.stringify(status).slice(0, 200);
    console.log(`  Response: ${preview}${preview.length >= 200 ? '…' : ''}`);
  } catch (err) {
    const e = err as RpcError;
    console.log(`  ✗ DEVNET UNREACHABLE: ${e.message}`);
    console.log(`  → ${DEVNET_URL} did not respond.`);
    console.log('  Check if devnet URL is correct or try GHOST_OCTRA_DEVNET_URL=<url>');
    process.exit(1);
  }

  // Step 2: nonce
  sep();
  console.log('[step 2] octra_nonce');
  let nonce = 0;
  try {
    const result = await rpc('octra_nonce', [address]);
    console.log(`  Raw: ${JSON.stringify(result)}`);
    if (result && typeof result === 'object' && 'nonce' in result) {
      nonce = Number((result as Record<string, unknown>)['nonce']);
    } else if (typeof result === 'number') {
      nonce = result;
    }
    console.log(`  ✓ Nonce: ${nonce}`);
  } catch (err) {
    const e = err as RpcError;
    console.log(`  ✗ Error ${e.rpcCode}: ${e.rpcMessage}`);
    if (e.rpcCode === 109) {
      console.log('  → Error 109 = invalid address. oct+base58(pubkey) derivation is WRONG.');
      console.log('  → Octra may use sha256(pubkey) or a different hash before base58.');
    }
    console.log('  Continuing with nonce=0 to capture the submit error…');
  }

  // Step 3: balance
  sep();
  console.log('[step 3] octra_balance');
  try {
    const result = await rpc('octra_balance', [address]);
    console.log(`  ✓ Balance: ${JSON.stringify(result)}`);
  } catch (err) {
    const e = err as RpcError;
    console.log(`  ✗ Error ${e.rpcCode}: ${e.rpcMessage}`);
  }

  // Step 4: corrected structure (payload OUTSIDE signing blob)
  sep();
  console.log('[step 4] octra_submit — CORRECTED structure');
  console.log('  signFields: { from, to_, amount, nonce, ou, timestamp }');
  console.log('  payload:    outside signing blob');

  const coreFields: Record<string, unknown> = {
    from: address,
    to_: '',
    amount: '0',
    nonce,
    ou: '250000',
    timestamp: Math.floor(Date.now() / 1000),
  };
  console.log(`\n  Signing blob: ${JSON.stringify(coreFields)}`);

  const { signature, public_key } = ed25519Sign(coreFields, seedHex);
  const correctedTx: Record<string, unknown> = {
    ...coreFields,
    signature,
    public_key,
    op_type: 'deploy_circle',
    payload: DEPLOY_PAYLOAD,
  };

  console.log('\n  Full tx:');
  console.log(JSON.stringify(correctedTx, null, 2));

  let correctedSucceeded = false;
  try {
    const result = await rpc('octra_submit', [correctedTx]);
    console.log('\n  ✓ SUCCESS — corrected structure ACCEPTED!');
    console.log(`  Result: ${JSON.stringify(result)}`);
    correctedSucceeded = true;
  } catch (err) {
    const e = err as RpcError;
    console.log(`\n  ✗ Error ${e.rpcCode}: ${e.rpcMessage}`);
    diagnose(e.rpcCode, address);
  }

  // Step 5: old structure (payload INSIDE signing blob) — compare
  sep();
  console.log('[step 5] octra_submit — OLD structure (comparison)');
  console.log('  Signing blob includes payload + op_type, no to_/amount/timestamp');

  const oldBody: Record<string, unknown> = {
    from: address,
    op_type: 'deploy_circle',
    payload: DEPLOY_PAYLOAD,
    nonce,
    ou: '250000',
  };
  const { signature: oldSig, public_key: oldPub } = ed25519Sign(oldBody, seedHex);
  const oldTx: Record<string, unknown> = { ...oldBody, signature: oldSig, public_key: oldPub };

  console.log('\n  Full tx:');
  console.log(JSON.stringify(oldTx, null, 2));

  try {
    const result = await rpc('octra_submit', [oldTx]);
    console.log('\n  ✓ OLD structure ACCEPTED');
    console.log(`  Result: ${JSON.stringify(result)}`);
    if (!correctedSucceeded) {
      console.log('\n  ⚠ FINDING: Old structure works, corrected does NOT.');
      console.log('  → payload MUST be inside the signing blob.');
    }
  } catch (err) {
    const e = err as RpcError;
    console.log(`\n  ✗ Error ${e.rpcCode}: ${e.rpcMessage}`);
    if (!correctedSucceeded) {
      console.log('\n  Both structures rejected — the blocker is likely elsewhere');
      console.log('  (address format, insufficient funds, or missing field).');
    }
  }

  sep();
  console.log('Test complete — review errors above for Q1/Q2 answers.');
}

function diagnose(code: number, address: string) {
  switch (code) {
    case 109:
      console.log('  → 109 = invalid address. Address derivation (oct+base58) is wrong.');
      break;
    case 110:
      console.log('  → 110 = likely bad signature or wrong signing field set.');
      console.log('  → Q2 may be wrong: try including payload in signing blob (step 5).');
      break;
    case 111:
      console.log('  → 111 = insufficient funds. Address format + signing are CORRECT!');
      console.log(`  → Fund this address via devnet faucet: ${address}`);
      break;
    case -32602:
      console.log('  → -32602 = invalid params. Wrong field types or missing required field.');
      console.log('  → Check to_ value, amount format, or timestamp type.');
      break;
    default:
      console.log(`  → Unknown error code ${code}. Check node docs or devnet explorer.`);
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
