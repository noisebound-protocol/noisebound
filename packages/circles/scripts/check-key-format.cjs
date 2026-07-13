// Reads GHOST_OCTRA_PRIVATE_KEY_HEX from .env (via dotenv or pre-loaded env)
// and derives Ed25519 public keys two ways. Does NOT print the private key.
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Manually parse the root .env file
const envPath = path.resolve(__dirname, '../../../.env');
const envLines = fs.readFileSync(envPath, 'utf8').split('\n');
const env = {};
for (const line of envLines) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) env[m[1].trim()] = m[2].trim();
}

const KEY = env['GHOST_OCTRA_PRIVATE_KEY_HEX'];
const ADDRESS = env['GHOST_OCTRA_ADDRESS'];

if (!KEY) {
  console.error('ERROR: GHOST_OCTRA_PRIVATE_KEY_HEX not found in .env');
  process.exit(1);
}

console.log('Target address:', ADDRESS);
console.log('');

// --- STEP 3: character analysis ---
console.log('=== STEP 3: Key character analysis ===');
console.log('Length (chars):', KEY.length);
const hexOnly = /^[0-9a-fA-F]+$/.test(KEY);
const hasBase64Special = /[+/=]/.test(KEY);
console.log('Pure hex chars (0-9, a-f only):', hexOnly);
console.log('Contains base64-specific chars (+, /, =):', hasBase64Special);
if (KEY.length === 64 && hexOnly) {
  console.log('Verdict: STORED AS HEX (64 hex chars = 32 bytes)');
} else if (!hexOnly) {
  console.log('Verdict: NOT pure hex — likely base64');
} else {
  console.log('Verdict: hex chars but unusual length (' + KEY.length + ')');
}

// PKCS8 DER wrapper for Ed25519 seed (RFC 8410 / RFC 5958)
const PKCS8_ED25519_HEADER = Buffer.from('302e020100300506032b657004220420', 'hex');

function seedToPublicKeyB64(seedBuf) {
  if (seedBuf.length !== 32) throw new Error('seed must be 32 bytes, got ' + seedBuf.length);
  const pkcs8Der = Buffer.concat([PKCS8_ED25519_HEADER, seedBuf]);
  const privKey = crypto.createPrivateKey({ key: pkcs8Der, format: 'der', type: 'pkcs8' });
  const pubKey = crypto.createPublicKey(privKey);
  // SPKI DER: last 32 bytes are the raw Ed25519 public key
  const spkiDer = pubKey.export({ format: 'der', type: 'spki' });
  return spkiDer.slice(-32).toString('base64');
}

console.log('');
console.log('=== STEP 2: Key derivation ===');

// Way A: treat as hex-encoded 32-byte seed
try {
  const seedA = Buffer.from(KEY, 'hex');
  console.log('Way A: hex -> seed bytes:', seedA.length, 'bytes');
  const pubA = seedToPublicKeyB64(seedA);
  console.log('Way A pubkey (base64):', pubA);
} catch (e) {
  console.log('Way A ERROR:', e.message);
}

// Way B: treat as base64-encoded seed
try {
  const seedB = Buffer.from(KEY, 'base64');
  console.log('Way B: base64 -> seed bytes:', seedB.length, 'bytes');
  if (seedB.length !== 32) {
    console.log('Way B: cannot use as Ed25519 seed (need 32 bytes, got ' + seedB.length + ')');
  } else {
    const pubB = seedToPublicKeyB64(seedB);
    console.log('Way B pubkey (base64):', pubB);
  }
} catch (e) {
  console.log('Way B ERROR:', e.message);
}

console.log('');
console.log('=== STEP 1 note ===');
console.log('Octra RPC query for octra_publicKey must be run separately (rate-limited).');
console.log('Address queried:', ADDRESS);
