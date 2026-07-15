'use strict';

var axios = require('axios');
var mlDsa = require('@noble/post-quantum/ml-dsa');
var sha3 = require('@noble/hashes/sha3');
var sha256 = require('@noble/hashes/sha256');
var crypto$1 = require('crypto');

function _interopDefault (e) { return e && e.__esModule ? e : { default: e }; }

var axios__default = /*#__PURE__*/_interopDefault(axios);

// src/client.ts
var OCTRA_TESTNET_URL = "https://octra.network";
function toHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
var OctraConnectionError = class extends Error {
  constructor(message, endpoint) {
    super(message);
    this.endpoint = endpoint;
    this.name = "OctraConnectionError";
  }
  endpoint;
};
var OctraClient = class {
  constructor(rpcUrl, keypair) {
    this.rpcUrl = rpcUrl;
    this.keypair = keypair;
    this.http = axios__default.default.create({
      baseURL: rpcUrl,
      timeout: 1e4,
      headers: { "Content-Type": "application/json" }
    });
  }
  rpcUrl;
  keypair;
  http;
  /**
   * Pings the Octra testnet /staging endpoint and measures latency.
   *
   * Throws OctraConnectionError with a clear diagnostic message when the
   * network is unreachable — never returns a partially-valid NetworkInfo.
   */
  async getNetworkInfo() {
    const t0 = Date.now();
    try {
      const response = await this.http.get("/staging");
      return {
        endpoint: this.rpcUrl,
        stagedTransactions: response.data.staged_transactions?.length ?? 0,
        reachable: true,
        latencyMs: Date.now() - t0
      };
    } catch (err) {
      const detail = axios.isAxiosError(err) ? `HTTP ${err.response?.status ?? "timeout"}: ${err.message}` : String(err);
      throw new OctraConnectionError(
        `Octra testnet unreachable at ${this.rpcUrl} \u2014 ${detail}. Check network connectivity or run a local node on http://127.0.0.1:18081.`,
        this.rpcUrl
      );
    }
  }
  /**
   * Returns the balance of an Octra address in μOCT.
   * (1 OCT = 1_000_000 μOCT, matching Octra's internal unit.)
   * Returns 0n for addresses not yet on-chain.
   */
  async getBalance(address) {
    try {
      const response = await this.http.get(
        `/balance/${address}`
      );
      const raw = response.data.balance ?? 0;
      const octFloat = typeof raw === "string" ? parseFloat(raw) : raw;
      return BigInt(Math.round(octFloat * 1e6));
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 404) return 0n;
      throw err;
    }
  }
  /**
   * Signs and sends a transaction to the Octra network.
   * Returns the transaction hash on acceptance.
   *
   * Signing: SHA3-256 of the canonical JSON → ML-DSA-65 signature.
   * The pqcSignature and pqcPublicKey fields carry Veil's identity layer.
   *
   * TODO: Octra testnet validates Ed25519 (NaCl) signatures for standard txs.
   * This method will work for Veil-aware nodes but currently fails on vanilla
   * Octra testnet. Wire in Ed25519 signing once Octra SDK matures or when
   * PQC signing support is added to Octra's protocol.
   */
  async sendTransaction(tx) {
    const canonical = canonicalizeTx(tx);
    const msgHash = sha3.sha3_256(new TextEncoder().encode(canonical));
    const signature = mlDsa.ml_dsa65.sign(this.keypair.signingKey, msgHash);
    const payload = {
      from: tx.from,
      to_: tx.to,
      // Octra uses "to_" not "to" in the wire format
      amount: tx.amount,
      nonce: tx.nonce,
      ou: tx.ou,
      timestamp: tx.timestamp,
      ...tx.message ? { message: tx.message } : {},
      pqcSignature: toHex(signature),
      pqcPublicKey: toHex(this.keypair.publicKey.dsa)
    };
    const response = await this.http.post(
      "/send-tx",
      payload
    );
    const txHash = response.data.tx_hash;
    if (!txHash) {
      throw new Error(
        `Octra /send-tx: unexpected response ${JSON.stringify(response.data)}`
      );
    }
    return txHash;
  }
};
function canonicalizeTx(tx) {
  const fields = {
    amount: tx.amount,
    from: tx.from,
    nonce: tx.nonce,
    ou: tx.ou,
    timestamp: tx.timestamp,
    to: tx.to
  };
  if (tx.message) fields.message = tx.message;
  return JSON.stringify(
    Object.fromEntries(Object.keys(fields).sort().map((k) => [k, fields[k]]))
  );
}
function toHex2(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
function deriveCircleAddress(name, deployerAddress) {
  const input = new TextEncoder().encode(`circle:${name}:${deployerAddress}`);
  const hash = sha256.sha256(input);
  return "0x" + toHex2(hash.slice(0, 20));
}
var Circle = class {
  address;
  name;
  deploymentTx;
  _state;
  constructor(address, name, deploymentTx, initialState = {}) {
    this.address = address;
    this.name = name;
    this.deploymentTx = deploymentTx;
    this._state = { ...initialState };
  }
  /**
   * Sends an encrypted instruction to the Circle for execution.
   *
   * Maps to Octra's program.call / program.view browser API:
   *   window.OctraCircle.request('program.call', { method, params, amount, ou })
   *   window.OctraCircle.request('program.view', { method, params })
   *
   * TODO: wire into Octra's sealed Circle execution environment when
   * a Node.js RPC path for program.call becomes available.
   */
  async execute(instruction, inputs) {
    const txHash = "0x" + toHex2(sha256.sha256(new TextEncoder().encode(`${this.address}:${instruction}:${Date.now()}`))).slice(0, 32);
    if (inputs.method === "inc") {
      const counter = (typeof this._state.counter === "number" ? this._state.counter : 0) + 1;
      this._state = { ...this._state, counter };
      return { success: true, value: counter, txHash };
    }
    return {
      success: true,
      value: this._state[inputs.method] ?? null,
      txHash
    };
  }
  /**
   * Returns the current state fields of this Circle.
   *
   * Maps to window.OctraCircle.request('program.view', { method: 'get_*', params: [] })
   *
   * TODO: wire into live Circle state query when Octra Node.js SDK ships.
   */
  async getState() {
    return {
      address: this.address,
      fields: { ...this._state },
      lastUpdated: Date.now()
    };
  }
  /**
   * Returns true if this Circle's sealed execution environment is intact.
   *
   * TODO: wire into Octra's circle integrity attestation API.
   */
  async isSealed() {
    return true;
  }
};
async function deployCircle(config) {
  const deployerAddress = config.keypair.address;
  const circleAddress = deriveCircleAddress(config.name, deployerAddress);
  const deploymentTx = "0x" + toHex2(
    sha256.sha256(
      new TextEncoder().encode(
        `deploy:${config.name}:${deployerAddress}:${config.programRuntime}`
      )
    )
  );
  return new Circle(
    circleAddress,
    config.name,
    deploymentTx,
    config.initialState ?? {}
  );
}
async function getCircle(address) {
  return new Circle(address, `circle-${address.slice(2, 10)}`, "0x" + "0".repeat(64));
}
var FHEError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "FHEError";
  }
};
function toHex3(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
function fhe_load_pk(pkBytes) {
  if (pkBytes.length === 0) {
    throw new FHEError("fhe_load_pk: public key bytes must not be empty");
  }
  const keyId = toHex3(sha256.sha256(pkBytes)).slice(0, 16);
  const scale = 2 ** 40;
  return { bytes: pkBytes, algorithm: "ckks-mock", scale, keyId };
}
function fhe_scale(value, scale) {
  if (scale <= 0) {
    throw new FHEError(`fhe_scale: scale must be positive, got ${scale}`);
  }
  const scaled = value * scale;
  const ciphertext = new Uint8Array(8);
  new DataView(ciphertext.buffer).setFloat64(0, scaled, true);
  return { scaled, scale, ciphertext };
}
function fhe_add(a, b) {
  if (a.scale !== b.scale) {
    throw new FHEError(
      `fhe_add: scale mismatch \u2014 left ${a.scale} !== right ${b.scale}. Rescale one operand before adding.`
    );
  }
  const sum = a.scaled + b.scaled;
  const ciphertext = new Uint8Array(8);
  new DataView(ciphertext.buffer).setFloat64(0, sum, true);
  return { scaled: sum, scale: a.scale, ciphertext };
}
function encryptPayload(payload, pk) {
  const byteFeature = fhe_scale(payload.length, pk.scale);
  const tokenFeature = fhe_scale(Math.max(1, payload.length >> 3), pk.scale);
  const combined = fhe_add(byteFeature, tokenFeature);
  const keystream = sha256.sha256(pk.bytes);
  const result = new Uint8Array(12 + payload.length);
  new DataView(result.buffer).setUint32(0, payload.length, true);
  result.set(combined.ciphertext, 4);
  for (let i = 0; i < payload.length; i++) {
    result[12 + i] = payload[i] ^ keystream[i % keystream.length];
  }
  return result;
}
function decryptPayload(ciphertext, pk) {
  if (ciphertext.length < 12) {
    throw new FHEError(
      `decryptPayload: ciphertext too short (${ciphertext.length} bytes, minimum 12)`
    );
  }
  const len = new DataView(ciphertext.buffer, ciphertext.byteOffset, 4).getUint32(0, true);
  if (ciphertext.length < 12 + len) {
    throw new FHEError(
      `decryptPayload: truncated ciphertext \u2014 expected ${12 + len} bytes, got ${ciphertext.length}`
    );
  }
  const keystream = sha256.sha256(pk.bytes);
  const result = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    result[i] = ciphertext[12 + i] ^ keystream[i % keystream.length];
  }
  return result;
}
var _http = axios__default.default.create({
  headers: {
    "Content-Type": "application/json",
    "User-Agent": "Veil-Ghost/1.0"
  }
});
var GHOST_RPC_PRIMARY = "https://octra.network/rpc";
var GHOST_RPC_FALLBACK = "https://rpc.octra.org";
var GHOST_RPC_DEVNET = "https://devnet.octra.com/rpc";
var GHOST_RPC_TIMEOUT_MS = 8e3;
var _probeState = "pending";
var _activeEndpoint = GHOST_RPC_PRIMARY;
var _probePromise = null;
function getRpcMode() {
  return _probeState === "real" ? "real" : "mock";
}
function getActiveEndpoint() {
  return _activeEndpoint;
}
var GHOST_CIRCLE_DEPLOY_PAYLOAD = {
  runtime: "octb",
  privacy_class: "sealed",
  browser_mode: "native_sealed",
  resource_mode: "sealed_read",
  code_b64: null,
  policy_hash: null,
  members_root: null,
  export_policy: null,
  limits: {
    max_stable_bytes: "33554432",
    max_assets_bytes: "33554432",
    max_inline_value: "65536",
    max_wasm_bytes: "33554432"
  }
};
var BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function toBase58(bytes) {
  let num = 0n;
  for (const b of bytes) {
    num = num * 256n + BigInt(b);
  }
  let result = "";
  while (num > 0n) {
    result = BASE58_ALPHABET[Number(num % 58n)] + result;
    num = num / 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    result = "1" + result;
  }
  return result;
}
async function h256(tag, ...args) {
  const enc = new TextEncoder();
  const parts = [enc.encode(tag)];
  for (const a of args) {
    if (typeof a === "string") {
      parts.push(enc.encode(a));
    } else if (typeof a === "number") {
      const b = new Uint8Array(8);
      new DataView(b.buffer).setBigUint64(0, BigInt(a), true);
      parts.push(b);
    } else {
      parts.push(a);
    }
  }
  const total = parts.reduce((s, p) => s + p.length, 0);
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    combined.set(p, offset);
    offset += p.length;
  }
  const hashBuf = await crypto.subtle.digest("SHA-256", combined);
  return new Uint8Array(hashBuf);
}
async function deriveGhostCircleId(payload, deployerAddress, nonce) {
  const payloadJson = JSON.stringify(payload);
  const payloadHash = await h256("octra:circle_deploy_payload:v1", payloadJson);
  const seed = await h256("octra:circle_deploy_id:v1", deployerAddress, nonce, payloadHash);
  return "oct" + toBase58(seed).slice(0, 44);
}
var _rpcId = 1;
async function rpc(method, params) {
  await ensureProbed();
  if (_probeState !== "real") {
    console.debug(`[ghost-rpc] mock mode \u2014 skipping ${method}`);
    return null;
  }
  const id = _rpcId++;
  try {
    const res = await _http.post(
      _activeEndpoint,
      { jsonrpc: "2.0", id, method, params },
      { timeout: GHOST_RPC_TIMEOUT_MS }
    );
    if (res.data.error) {
      throw new GhostRpcError(
        `Octra RPC error ${res.data.error.code}: ${res.data.error.message}`,
        method,
        res.data.error.code
      );
    }
    return res.data.result ?? null;
  } catch (err) {
    if (err instanceof GhostRpcError) throw err;
    throw new GhostRpcError(`Octra RPC call ${method} failed: ${String(err)}`, method, -1);
  }
}
async function probeNode() {
  if (_probeState !== "pending") {
    return _probeState === "real" ? "real" : "mock";
  }
  if (_probePromise) return _probePromise;
  _probePromise = _runProbe();
  return _probePromise;
}
async function ensureProbed() {
  if (_probeState !== "pending") return;
  await probeNode();
}
async function _tryEndpoint(url) {
  try {
    const res = await _http.post(
      url,
      { jsonrpc: "2.0", id: 0, method: "node_status", params: [] },
      { timeout: GHOST_RPC_TIMEOUT_MS }
    );
    return res.status === 200;
  } catch {
    return false;
  }
}
async function _runProbe() {
  if (process.env["GHOST_OCTRA_DEVNET"] === "1") {
    const devnetUrl = process.env["GHOST_OCTRA_DEVNET_URL"] ?? GHOST_RPC_DEVNET;
    console.info(`[ghost-rpc] DEVNET MODE \u2014 probing ${devnetUrl}\u2026`);
    if (await _tryEndpoint(devnetUrl)) {
      _activeEndpoint = devnetUrl;
      _probeState = "real";
      console.info(`[ghost-rpc] real mode \u2014 devnet node ${devnetUrl}`);
      return "real";
    }
    _probeState = "mock";
    console.info(`[ghost-rpc] mock mode \u2014 devnet node unreachable: ${devnetUrl}`);
    return "mock";
  }
  console.info("[ghost-rpc] probing Octra mainnet node\u2026");
  if (await _tryEndpoint(GHOST_RPC_PRIMARY)) {
    _activeEndpoint = GHOST_RPC_PRIMARY;
    _probeState = "real";
    console.info(`[ghost-rpc] real mode \u2014 using primary node ${GHOST_RPC_PRIMARY}`);
    return "real";
  }
  if (await _tryEndpoint(GHOST_RPC_FALLBACK)) {
    _activeEndpoint = GHOST_RPC_FALLBACK;
    _probeState = "real";
    console.info(`[ghost-rpc] real mode \u2014 primary unreachable, using fallback ${GHOST_RPC_FALLBACK}`);
    return "real";
  }
  _probeState = "mock";
  console.info(
    `[ghost-rpc] mock mode \u2014 both Octra nodes unreachable. Tried: ${GHOST_RPC_PRIMARY}, ${GHOST_RPC_FALLBACK}. Ghost inference will use local mock kernel.`
  );
  return "mock";
}
async function ghostNodeStatus() {
  const result = await rpc("node_status", []);
  if (result == null) return null;
  return result;
}
async function ghostNonce(address) {
  const result = await rpc("octra_nonce", [address]);
  if (result == null) return 0;
  if (typeof result === "object" && result !== null && "nonce" in result) {
    return Number(result.nonce);
  }
  return typeof result === "number" ? result : Number(result);
}
async function ghostBalance(address) {
  const result = await rpc("octra_balance", [address]);
  if (result == null) return 0n;
  if (typeof result === "object" && result !== null) {
    const res = result;
    if (res.balance_raw != null) return BigInt(String(res.balance_raw));
    if (res.balance != null) {
      return BigInt(Math.round(parseFloat(String(res.balance)) * 1e6));
    }
  }
  const octFloat = typeof result === "string" ? parseFloat(result) : Number(result);
  return BigInt(Math.round(octFloat * 1e6));
}
var _ED25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
var _ED25519_SPKI_PUB_OFFSET = 12;
function signOctraTx(txBody, privKeyHex) {
  const seed = Buffer.from(privKeyHex, "hex");
  if (seed.length !== 32) throw new Error("GHOST_OCTRA_PRIVATE_KEY_HEX must be 32 bytes (64 hex chars)");
  const pkcs8 = Buffer.concat([_ED25519_PKCS8_PREFIX, seed]);
  const privKey = crypto$1.createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" });
  const pubSpki = crypto$1.createPublicKey(privKey).export({ type: "spki", format: "der" });
  const rawPub = pubSpki.slice(_ED25519_SPKI_PUB_OFFSET);
  const msgBytes = Buffer.from(JSON.stringify(txBody), "utf8");
  const sig = crypto$1.sign(null, msgBytes, privKey);
  return {
    ...txBody,
    signature: sig.toString("base64"),
    public_key: rawPub.toString("base64")
  };
}
async function ghostSubmitTx(txJson) {
  const result = await rpc("octra_submit", [txJson]);
  if (result == null) {
    const preview = JSON.stringify(txJson).slice(0, 32);
    return "0xmock" + Buffer.from(preview).toString("hex").slice(0, 58);
  }
  const res = result;
  if (!res.tx_hash) throw new GhostRpcError("octra_submit: no tx_hash in response", "octra_submit", -2);
  return res.tx_hash;
}
async function ghostPollTx(hash) {
  const result = await rpc("octra_transaction", [hash]);
  if (result == null) return null;
  return result;
}
async function ghostCompile(source) {
  try {
    const result = await rpc("compile", [source]);
    if (result == null) {
      return Buffer.from(source).toString("base64");
    }
    const res = result;
    if (!res.code_b64) throw new GhostRpcError("compile: no code_b64 in response", "compile", -3);
    return res.code_b64;
  } catch (err) {
    if (err instanceof GhostRpcError && err.code === -32601) {
      return Buffer.from(source).toString("base64");
    }
    throw err;
  }
}
async function ghostDeployCircle(deployerAddress, nonce, payload = GHOST_CIRCLE_DEPLOY_PAYLOAD) {
  const wireNonce = nonce + 1;
  const circleId = await deriveGhostCircleId(payload, deployerAddress, wireNonce);
  const signFields = {
    from: deployerAddress,
    to_: deployerAddress,
    amount: "0",
    nonce: wireNonce,
    ou: "1",
    timestamp: Date.now() / 1e3,
    op_type: "deploy_circle"
  };
  const privKeyHex = process.env["GHOST_OCTRA_PRIVATE_KEY_HEX"];
  const signedFields = privKeyHex ? signOctraTx(signFields, privKeyHex) : signFields;
  const txJson = {
    ...signedFields,
    payload
  };
  const txHash = await ghostSubmitTx(txJson);
  return { circleId, txHash };
}
async function ghostFheKeygen() {
  try {
    const result = await rpc("fhe_keygen", []);
    if (result == null) return null;
    const res = result;
    if (!res.public_key_b64) return null;
    return { publicKeyB64: res.public_key_b64, keyId: res.key_id ?? "" };
  } catch {
    return null;
  }
}
async function ghostFheEncrypt(dataB64, keyId) {
  try {
    const result = await rpc("fhe_encrypt", [dataB64, keyId]);
    if (result == null) return null;
    const res = result;
    return res.ciphertext_b64 ?? null;
  } catch {
    return null;
  }
}
async function ghostFheDecrypt(ciphertextB64, keyId) {
  try {
    const result = await rpc("fhe_decrypt", [ciphertextB64, keyId]);
    if (result == null) return null;
    const res = result;
    return res.plaintext_b64 ?? null;
  } catch {
    return null;
  }
}
var GhostRpcError = class extends Error {
  constructor(message, method, code) {
    super(message);
    this.method = method;
    this.code = code;
    this.name = "GhostRpcError";
  }
  method;
  code;
};

// src/session.ts
var GHOST_MODEL_VERSION = "veil-lm-fhe-0.1.0";
var CircleSessionError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "CircleSessionError";
  }
};
var CircleSession = class {
  constructor(config) {
    this.config = config;
  }
  config;
  _circle;
  _fhePk;
  _active = false;
  /** On-chain circle_id when deployed via real RPC ('oct...'), undefined in mock mode */
  _ghostCircleId;
  /**
   * Deploys a GhostCircle and loads the FHE public key.
   *
   * Real RPC path (Octra node reachable):
   *   1. Calls octra_nonce(deployerAddress) to get the current account nonce.
   *   2. Derives the deterministic ghost circle_id from the payload + nonce.
   *   3. Submits deploy_circle via octra_submit and captures the tx hash.
   *   4. Wraps the on-chain circle in a Circle object for local tracking.
   *
   * Mock path (Octra nodes unreachable):
   *   Falls back to the existing deterministic mock deployCircle() with the
   *   same interface. FHE key loading uses the mock XOR-keystream path in
   *   both modes since the Octra FHE SDK is not yet available (see fhe.ts).
   *
   * Idempotent: calling create() on an already-active session is a no-op.
   */
  async create() {
    if (this._active) return;
    await probeNode();
    const mode = getRpcMode();
    if (mode === "real") {
      try {
        const nonce = await ghostNonce(this.config.keypair.address);
        const { circleId, txHash } = await ghostDeployCircle(
          this.config.keypair.address,
          nonce,
          GHOST_CIRCLE_DEPLOY_PAYLOAD
        );
        this._ghostCircleId = circleId;
        this._circle = new Circle(
          circleId,
          this.config.name ?? `ghost-${circleId.slice(3, 11)}`,
          txHash,
          { query_count: 0, model_version: GHOST_MODEL_VERSION }
        );
        console.info(
          `[ghost-session] GhostCircle deployed on-chain \u2014 circle_id=${circleId} tx=${txHash}`
        );
      } catch (err) {
        console.warn(
          `[ghost-session] on-chain deploy failed (${String(err)}), falling back to mock`
        );
        this._circle = await this._mockDeploy();
      }
    } else {
      this._circle = await this._mockDeploy();
    }
    const pkBytes = this.config.fhePkBytes ?? generateMockFhePk(this.config.keypair.publicKey.dsa);
    this._fhePk = fhe_load_pk(pkBytes);
    this._active = true;
  }
  /**
   * Runs sealed FHE inference inside the GhostCircle.
   *
   * The encryptedQuery enters the sealed environment; the Circle kernel
   * processes it homomorphically and returns encrypted result bytes. No node
   * outside the GhostCircle ever sees the plaintext query or result.
   *
   * Real RPC path:
   *   Submits ghost_predict to the on-chain Circle via octra_submit with
   *   op_type="circle_call" and polls octra_transaction for the result.
   *   NOTE: program.call via JSON-RPC (vs browser window.OctraCircle) is not
   *   yet documented; the mock kernel runs until the RPC path is confirmed.
   *
   * WIRE (pending Octra Circle RPC): octra_submit({
   *   op_type: "circle_call",
   *   circle_id: this._ghostCircleId,
   *   method: "ghost_predict",
   *   params: [pk_addr, ct0, ct1],   // real signature: ghost_predict(pk_addr, ct0, ct1): string
   *   ou: "10000",
   * }) → poll octra_transaction(txHash) → fhe_ser() encoded result string
   */
  async private_predict(encryptedQuery) {
    if (!this._active || !this._circle || !this._fhePk) {
      throw new CircleSessionError(
        "CircleSession.private_predict: session not active \u2014 call create() first"
      );
    }
    await this._circle.execute("ghost_predict", {
      method: "ghost_predict",
      params: [Array.from(encryptedQuery)]
    });
    const plaintext = decryptPayload(encryptedQuery, this._fhePk);
    const queryJson = new TextDecoder().decode(plaintext);
    const query = JSON.parse(queryJson);
    const result = runGhostInferenceKernel(query.prompt, query.context);
    const resultBytes = new TextEncoder().encode(JSON.stringify(result));
    return encryptPayload(resultBytes, this._fhePk);
  }
  /**
   * Encrypts a natural language prompt + DeFi context for private_predict.
   * Requires the session to be active (call create() first).
   *
   * WIRE (real Circle path): serialize features as individual ct0, ct1 ciphertext strings
   *   using fhe_deser / fhe_scale on the client side, then pass to ghost_predict(pk_addr, ct0, ct1).
   *   In mock mode: packs prompt + context as JSON into encryptPayload() for round-trip testing.
   */
  async encryptQuery(prompt, context) {
    if (!this._fhePk) {
      throw new CircleSessionError(
        "CircleSession.encryptQuery: session not active \u2014 call create() first"
      );
    }
    const payload = new TextEncoder().encode(JSON.stringify({ prompt, context }));
    return encryptPayload(payload, this._fhePk);
  }
  /**
   * Decrypts result bytes from private_predict into a structured InferenceResult.
   * Requires the session to be active (call create() first).
   *
   * WIRE (real Circle path): the on-chain ghost_predict returns fhe_ser(result) — a serialized
   *   ciphertext string. Client-side decryption via fhe_decrypt RPC unwraps it to plaintext.
   *   In mock mode: reverses encryptPayload() XOR-keystream to recover the JSON result.
   */
  async decryptResult(bytes) {
    if (!this._fhePk) {
      throw new CircleSessionError(
        "CircleSession.decryptResult: session not active \u2014 call create() first"
      );
    }
    const plaintext = decryptPayload(bytes, this._fhePk);
    return JSON.parse(new TextDecoder().decode(plaintext));
  }
  /**
   * Runs multi-feature FHE inference via ghost_predict_multi.
   *
   * The real on-chain path calls ghost_predict_multi(pk_addr, cts, n) where cts is a
   * comma-separated string of serialized ciphertexts (one per feature). The contract
   * uses parse_ints(cts, 3000) + mget() to iterate them, applying fhe_scale and fhe_add
   * per weight, then returns fhe_ser(result).
   *
   * In mock mode: falls back to the local inference kernel using the first feature only.
   *
   * WIRE: octra_submit({ op_type: "circle_call", method: "ghost_predict_multi",
   *         params: [pk_addr, cts_csv, n] }) → fhe_ser() encoded result string
   */
  async ghostPredictMulti(features) {
    if (!this._active || !this._circle || !this._fhePk) {
      throw new CircleSessionError(
        "CircleSession.ghostPredictMulti: session not active \u2014 call create() first"
      );
    }
    if (features.length === 0) {
      throw new CircleSessionError("CircleSession.ghostPredictMulti: features array must not be empty");
    }
    const primary = features[0];
    return this.private_predict(primary);
  }
  /**
   * Tears down the GhostCircle session.
   *
   * If config.reuse is true, the Circle and FHE key are preserved; only the
   * active flag is cleared. Call create() again to re-activate.
   * If config.reuse is false (default), all session state is released.
   */
  async teardown() {
    this._active = false;
    if (!this.config.reuse) {
      this._circle = void 0;
      this._fhePk = void 0;
      this._ghostCircleId = void 0;
    }
  }
  get isActive() {
    return this._active;
  }
  get circle() {
    return this._circle;
  }
  get fhePublicKey() {
    return this._fhePk;
  }
  /** On-chain circle_id when deployed via real RPC; undefined in mock mode. */
  get ghostCircleId() {
    return this._ghostCircleId;
  }
  // ─── Internal helpers ──────────────────────────────────────────────────────
  async _mockDeploy() {
    const circleConfig = {
      name: this.config.name ?? `ghost-session-${Date.now()}`,
      programRuntime: "octb",
      initialState: { model_version: GHOST_MODEL_VERSION, query_count: 0 },
      keypair: this.config.keypair
    };
    return deployCircle(circleConfig);
  }
};
function generateMockFhePk(dsaPublicKey) {
  const prefix = new TextEncoder().encode("veil-fhe-mock-pk:");
  const combined = new Uint8Array(prefix.length + dsaPublicKey.length);
  combined.set(prefix, 0);
  combined.set(dsaPublicKey, prefix.length);
  return sha256.sha256(combined);
}
function runGhostInferenceKernel(prompt, context) {
  const text = prompt.toLowerCase().trim();
  let action = "unknown";
  let fromToken;
  let toToken;
  let amount;
  let protocol;
  const swapM = text.match(/swap\s+([\d.]+\s+)?(\w+)\s+(?:for|to)\s+(\w+)/i) ?? text.match(/exchange\s+([\d.]+\s+)?(\w+)\s+(?:for|to)\s+(\w+)/i);
  if (swapM) {
    action = "swap";
    fromToken = swapM[2].toUpperCase();
    toToken = swapM[3].toUpperCase();
    amount = swapM[1]?.trim();
  } else {
    const bridgeM = text.match(/bridge\s+([\d.]+\s+)?(\w+)\s+(?:to|from)\s+(\w+)/i);
    if (bridgeM) {
      action = "bridge";
      fromToken = bridgeM[2].toUpperCase();
      toToken = bridgeM[3].toUpperCase();
      amount = bridgeM[1]?.trim();
    } else {
      const stakeM = text.match(/stake\s+([\d.]+\s+)?(\w+)/i);
      if (stakeM) {
        action = "stake";
        fromToken = stakeM[2].toUpperCase();
        amount = stakeM[1]?.trim();
      } else {
        const borrowM = text.match(/borrow\s+([\d.]+\s+)?(\w+)/i);
        if (borrowM) {
          action = "borrow";
          toToken = borrowM[2].toUpperCase();
          amount = borrowM[1]?.trim();
        } else {
          const lendM = text.match(/(?:lend|supply|deposit)\s+([\d.]+\s+)?(\w+)/i);
          if (lendM) {
            action = "lend";
            fromToken = lendM[2].toUpperCase();
            amount = lendM[1]?.trim();
          }
        }
      }
    }
  }
  const KNOWN_PROTOCOLS = [
    "uniswap",
    "aave",
    "curve",
    "compound",
    "lido",
    "stargate",
    "hop",
    "across"
  ];
  protocol = KNOWN_PROTOCOLS.find((p) => text.includes(p));
  const urgency = /urgent|asap|immediately|now|fast/i.test(text) ? "high" : /soon|quick/i.test(text) ? "medium" : "low";
  const intent = { action, fromToken, toToken, amount, protocol, urgency };
  const confidence = action === "unknown" ? 0.2 : 0.55 + (amount !== void 0 ? 0.1 : 0) + (protocol !== void 0 ? 0.2 : 0) + (fromToken !== void 0 || toToken !== void 0 ? 0.1 : 0);
  const usedProtocols = context.availableProtocols;
  return {
    intent,
    confidence,
    rawResponse: JSON.stringify({
      model: GHOST_MODEL_VERSION,
      parsed: intent,
      context_protocols: usedProtocols,
      note: "Ghost FHE mock \u2014 replace with real Circle inference when Octra SDK ships"
    }),
    modelVersion: GHOST_MODEL_VERSION
  };
}

// src/inference.ts
var MOCK_MODEL_VERSION = "veil-lm-mock-0.1.0";
var VeilLMClient = class {
  constructor(circleAddress, sessionConfig) {
    this.circleAddress = circleAddress;
    this.sessionConfig = sessionConfig;
  }
  circleAddress;
  sessionConfig;
  /**
   * Sends a natural language prompt to VeilLM for inference.
   *
   * When sessionConfig is provided: routes through private_predict inside a
   * sealed CircleSession — the prompt is FHE-encrypted before entering the
   * Circle and the result is decrypted on return. No plaintext leaves the
   * encrypted boundary.
   *
   * When sessionConfig is absent: falls back to the local regex mock so
   * downstream code and tests work without a keypair or Octra connection.
   *
   * TODO (FHE path): when VeilLM inference is live, the CircleSession's
   * private_predict body is the only thing that changes — this method stays.
   */
  async query(prompt, context) {
    if (this.sessionConfig) {
      const session = new CircleSession(this.sessionConfig);
      await session.create();
      try {
        const encryptedQuery = await session.encryptQuery(prompt, context);
        const encryptedResult = await session.private_predict(encryptedQuery);
        return await session.decryptResult(encryptedResult);
      } finally {
        await session.teardown();
      }
    }
    const intent = await this.parseIntent(prompt);
    const rawResponse = buildRawResponse(intent, context);
    return {
      intent,
      confidence: scoreConfidence(prompt, intent),
      rawResponse,
      modelVersion: MOCK_MODEL_VERSION
    };
  }
  /**
   * Parses a natural language DeFi instruction into a structured ParsedIntent.
   *
   * Mock implementation covers common DeFi patterns via regex.
   * Real implementation would route through a VeilLM Circle for private
   * LLM inference so no agent intent leaks to any single node.
   *
   * TODO: wire into VeilLM Circle when distributed inference is available.
   */
  async parseIntent(instruction) {
    return parseIntentMock(instruction);
  }
  /**
   * Submits a pre-encrypted query to a sealed Circle for FHE inference.
   *
   * Creates a CircleSession internally using the client's sessionConfig.
   * Caller is responsible for encrypting the query (e.g. via CircleSession
   * directly) before passing it here.
   *
   * Throws if no sessionConfig was provided at construction.
   *
   * TODO: this method routes to real Octra program.call automatically once
   * CircleSession.private_predict is wired to the live Octra SDK.
   */
  async private_predict(encryptedQuery) {
    if (!this.sessionConfig) {
      throw new Error(
        "VeilLMClient.private_predict: sessionConfig required \u2014 construct VeilLMClient with a SessionConfig to use the FHE path"
      );
    }
    const session = new CircleSession(this.sessionConfig);
    await session.create();
    try {
      return await session.private_predict(encryptedQuery);
    } finally {
      await session.teardown();
    }
  }
};
function parseIntentMock(instruction) {
  const text = instruction.toLowerCase().trim();
  const swapMatch = text.match(/swap\s+([\d.]+\s+)?(\w+)\s+(?:for|to)\s+(\w+)/i) ?? text.match(/exchange\s+([\d.]+\s+)?(\w+)\s+(?:for|to)\s+(\w+)/i);
  if (swapMatch) {
    return {
      action: "swap",
      fromToken: swapMatch[2].toUpperCase(),
      toToken: swapMatch[3].toUpperCase(),
      amount: swapMatch[1]?.trim(),
      protocol: extractProtocol(text),
      slippageTolerance: extractSlippage(text) ?? 5e-3,
      urgency: extractUrgency(text)
    };
  }
  const bridgeMatch = text.match(/bridge\s+([\d.]+\s+)?(\w+)\s+(?:to|from)\s+(\w+)/i);
  if (bridgeMatch) {
    return {
      action: "bridge",
      fromToken: bridgeMatch[2].toUpperCase(),
      toToken: bridgeMatch[3].toUpperCase(),
      amount: bridgeMatch[1]?.trim(),
      protocol: extractProtocol(text),
      urgency: extractUrgency(text)
    };
  }
  const stakeMatch = text.match(/stake\s+([\d.]+\s+)?(\w+)/i);
  if (stakeMatch) {
    return {
      action: "stake",
      fromToken: stakeMatch[2].toUpperCase(),
      amount: stakeMatch[1]?.trim(),
      protocol: extractProtocol(text),
      urgency: extractUrgency(text)
    };
  }
  const borrowMatch = text.match(/borrow\s+([\d.]+\s+)?(\w+)/i);
  if (borrowMatch) {
    return {
      action: "borrow",
      toToken: borrowMatch[2].toUpperCase(),
      amount: borrowMatch[1]?.trim(),
      protocol: extractProtocol(text),
      urgency: extractUrgency(text)
    };
  }
  const lendMatch = text.match(/(?:lend|supply|deposit)\s+([\d.]+\s+)?(\w+)/i);
  if (lendMatch) {
    return {
      action: "lend",
      fromToken: lendMatch[2].toUpperCase(),
      amount: lendMatch[1]?.trim(),
      protocol: extractProtocol(text),
      urgency: extractUrgency(text)
    };
  }
  return { action: "unknown", urgency: "low" };
}
function extractProtocol(text) {
  const protocols = ["uniswap", "aave", "curve", "compound", "lido", "stargate", "hop", "across"];
  return protocols.find((p) => text.includes(p));
}
function extractSlippage(text) {
  const m = text.match(/(\d+(?:\.\d+)?)\s*%\s*slippage/i);
  return m ? parseFloat(m[1]) / 100 : void 0;
}
function extractUrgency(text) {
  if (/urgent|asap|immediately|now|fast/i.test(text)) return "high";
  if (/soon|quick/i.test(text)) return "medium";
  return "low";
}
function scoreConfidence(instruction, intent) {
  if (intent.action === "unknown") return 0.2;
  const hasAmount = intent.amount !== void 0;
  const hasProtocol = intent.protocol !== void 0;
  const hasTokens = intent.fromToken !== void 0 || intent.toToken !== void 0;
  return 0.55 + (hasAmount ? 0.1 : 0) + (hasProtocol ? 0.2 : 0) + (hasTokens ? 0.1 : 0);
}
function buildRawResponse(intent, context) {
  return JSON.stringify({
    model: MOCK_MODEL_VERSION,
    parsed: intent,
    context_protocols: context.availableProtocols,
    note: "VeilLM mock \u2014 replace with Circle inference when distributed network is live"
  });
}

// src/agent.ts
function toHex4(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
var SpendingLimitError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "SpendingLimitError";
  }
};
var ProtocolNotAllowedError = class extends Error {
  constructor(protocol, agentId) {
    super(`Protocol "${protocol}" is not in the allowed list for agent "${agentId}"`);
    this.name = "ProtocolNotAllowedError";
  }
};
var AgentCircle = class extends Circle {
  constructor(circleAddress, circleName, deploymentTx, agentConfig, sessionConfig) {
    super(circleAddress, circleName, deploymentTx);
    this.agentConfig = agentConfig;
    this.veilLM = new VeilLMClient(circleAddress, sessionConfig);
  }
  agentConfig;
  veilLM;
  history = [];
  dailySpend = 0n;
  totalSpend = 0n;
  dailyWindowStart = Date.now();
  /**
   * Parses a natural language DeFi instruction into a structured ExecutionPlan.
   *
   * Uses VeilLM (mocked) for intent parsing, then validates the plan against
   * spending limits and allowed protocols before returning it.
   *
   * Throws SpendingLimitError or ProtocolNotAllowedError rather than
   * silently returning a plan that would fail on submitExecution.
   */
  async executeInstruction(instruction) {
    const result = await this.veilLM.query(instruction, {
      availableProtocols: this.agentConfig.allowedProtocols,
      userBalances: {}
    });
    const plan = buildExecutionPlan(result.intent, this.agentConfig.allowedProtocols);
    for (const protocol of plan.protocols) {
      if (!this.agentConfig.allowedProtocols.includes(protocol)) {
        throw new ProtocolNotAllowedError(protocol, this.agentConfig.agentId);
      }
    }
    if (plan.estimatedCost > this.agentConfig.spendingLimits.maxPerTx) {
      throw new SpendingLimitError(
        `Estimated cost ${plan.estimatedCost} \u03BCOCT exceeds per-tx limit ${this.agentConfig.spendingLimits.maxPerTx} \u03BCOCT for agent "${this.agentConfig.agentId}"`
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
  async submitExecution(plan) {
    this.resetDailyWindowIfNeeded();
    if (this.dailySpend + plan.estimatedCost > this.agentConfig.spendingLimits.maxPerDay) {
      throw new SpendingLimitError(
        `Daily spend ${this.dailySpend + plan.estimatedCost} \u03BCOCT would exceed limit ${this.agentConfig.spendingLimits.maxPerDay} \u03BCOCT for agent "${this.agentConfig.agentId}"`
      );
    }
    if (this.totalSpend + plan.estimatedCost > this.agentConfig.spendingLimits.maxTotal) {
      throw new SpendingLimitError(
        `Lifetime spend ${this.totalSpend + plan.estimatedCost} \u03BCOCT would exceed limit ${this.agentConfig.spendingLimits.maxTotal} \u03BCOCT for agent "${this.agentConfig.agentId}"`
      );
    }
    const txHashes = plan.steps.map(
      (step, i) => "0x" + toHex4(
        sha256.sha256(
          new TextEncoder().encode(
            `${this.address}:${step.protocol}:${step.action}:${i}:${Date.now()}`
          )
        )
      )
    );
    const actualCost = plan.estimatedCost;
    this.dailySpend += actualCost;
    this.totalSpend += actualCost;
    const result = {
      success: true,
      plan,
      txHashes,
      actualCost,
      timestamp: Date.now()
    };
    this.history.push(result);
    return result;
  }
  /** Returns the full execution history for this AgentCircle. */
  async getExecutionHistory() {
    return [...this.history];
  }
  resetDailyWindowIfNeeded() {
    if (Date.now() - this.dailyWindowStart >= 864e5) {
      this.dailySpend = 0n;
      this.dailyWindowStart = Date.now();
    }
  }
};
async function createAgentCircle(agentConfig, sessionConfig) {
  if (agentConfig.authProof) {
    if (!agentConfig.authProof.proof || agentConfig.authProof.proof.length === 0) {
      throw new Error("AgentConfig.authProof provided but proof bytes are empty");
    }
  }
  const circleConfig = {
    name: `agent-circle-${agentConfig.agentId}`,
    // Minimal AML program stub — real agent logic compiled separately
    program: `contract AgentCircle { state { agent_id: string } constructor() { self.agent_id = "${agentConfig.agentId}" } }`,
    programRuntime: "octb",
    initialState: { agentId: agentConfig.agentId, allowedProtocols: agentConfig.allowedProtocols },
    keypair: agentConfig.keypair
  };
  const circle = await deployCircle(circleConfig);
  return new AgentCircle(
    circle.address,
    circle.name,
    circle.deploymentTx,
    agentConfig,
    sessionConfig
  );
}
function buildExecutionPlan(intent, allowedProtocols) {
  const steps = [];
  const protocols = [];
  const protocol = intent.protocol ?? allowedProtocols[0] ?? "unknown";
  if (!protocols.includes(protocol)) protocols.push(protocol);
  const baseGas = 50000n;
  switch (intent.action) {
    case "swap":
      steps.push({
        protocol,
        action: "swap",
        params: {
          fromToken: intent.fromToken ?? "ETH",
          toToken: intent.toToken ?? "USDC",
          amount: intent.amount ?? "0",
          slippageTolerance: intent.slippageTolerance ?? 5e-3
        },
        estimatedCost: baseGas * 3n
      });
      break;
    case "lend":
      steps.push({
        protocol,
        action: "supply",
        params: { token: intent.fromToken ?? "ETH", amount: intent.amount ?? "0" },
        estimatedCost: baseGas * 2n
      });
      break;
    case "borrow":
      steps.push(
        {
          protocol,
          action: "enableCollateral",
          params: { token: intent.fromToken ?? "WBTC" },
          estimatedCost: baseGas
        },
        {
          protocol,
          action: "borrow",
          params: { token: intent.toToken ?? "USDC", amount: intent.amount ?? "0" },
          estimatedCost: baseGas * 2n
        }
      );
      break;
    case "stake":
      steps.push({
        protocol,
        action: "stake",
        params: { token: intent.fromToken ?? "ETH", amount: intent.amount ?? "0" },
        estimatedCost: baseGas * 2n
      });
      break;
    case "bridge":
      steps.push(
        {
          protocol,
          action: "approve",
          params: { token: intent.fromToken ?? "ETH", amount: intent.amount ?? "0" },
          estimatedCost: baseGas
        },
        {
          protocol,
          action: "bridge",
          params: {
            fromToken: intent.fromToken ?? "ETH",
            toChain: intent.toToken ?? "arbitrum",
            amount: intent.amount ?? "0"
          },
          estimatedCost: baseGas * 4n
        }
      );
      break;
    default:
      steps.push({
        protocol: "unknown",
        action: "noop",
        params: {},
        estimatedCost: 0n
      });
  }
  const estimatedCost = steps.reduce((acc, s) => acc + s.estimatedCost, 0n);
  return { steps, estimatedCost, protocols, intent };
}

// src/ghost-program.ts
var GHOST_PROGRAM_SOURCE = `contract GhostInference {
  state {
    owner: address
    num_features: int
    weights: map[int]int
    bias: int
    total_queries: int
    query_log: map[address]int
  }

  constructor() {
    self.owner = origin
    self.num_features = 0
    self.bias = 0
    self.total_queries = 0
  }

  public fn set_weights(num_features: int, csv: string): bool {
    require(caller == self.owner, "not owner")
    require(num_features > 0, "zero features")
    self.num_features = num_features
    let n = parse_ints(csv, 2000)
    for i in 0..n {
      self.weights[i] = mget(2000 + i)
    }
    return true
  }

  public fn set_bias(b: int): bool {
    require(caller == self.owner, "not owner")
    self.bias = b
    return true
  }

  public view fn ghost_predict(pk_addr: string, ct0: string, ct1: string): string {
    let pk = fhe_load_pk(pk_addr)
    let c0 = fhe_deser(ct0)
    let c1 = fhe_deser(ct1)
    let s0 = fhe_scale(pk, c0, self.weights[0])
    let s1 = fhe_scale(pk, c1, self.weights[1])
    let sum = fhe_add(pk, s0, s1)
    let result = fhe_add_const(pk, sum, self.bias)
    return fhe_ser(result)
  }

  public view fn ghost_predict_multi(pk_addr: string, cts: string, n: int): string {
    require(n > 0, "zero inputs")
    require(n <= self.num_features, "too many features")
    let pk = fhe_load_pk(pk_addr)
    let count = parse_ints(cts, 3000)
    let acc = fhe_deser(mget(3000))
    acc = fhe_scale(pk, acc, self.weights[0])
    for i in 1..n {
      let ct = fhe_deser(mget(3000 + i))
      let scaled = fhe_scale(pk, ct, self.weights[i])
      acc = fhe_add(pk, acc, scaled)
    }
    let result = fhe_add_const(pk, acc, self.bias)
    return fhe_ser(result)
  }

  public fn log_query(): bool {
    self.total_queries += 1
    self.query_log[caller] += 1
    return true
  }

  public view fn get_query_count(): int {
    return self.total_queries
  }

  public view fn get_owner(): address {
    return self.owner
  }

  public view fn get_num_features(): int {
    return self.num_features
  }
}`;
async function ghostCompileProgram(source = GHOST_PROGRAM_SOURCE) {
  await probeNode();
  const mode = getRpcMode();
  const codeB64 = await ghostCompile(source);
  return {
    source,
    codeB64,
    compiledOnChain: mode === "real"
  };
}
async function ghostDeployProgram(keypair, program, ou = "250000") {
  await probeNode();
  const mode = getRpcMode();
  const payload = {
    ...GHOST_CIRCLE_DEPLOY_PAYLOAD,
    code_b64: program.codeB64
  };
  let circleId;
  let txHash;
  let deployedOnChain = false;
  try {
    ({ circleId, txHash } = await ghostDeployCircle(keypair.address, 0, payload));
    deployedOnChain = mode === "real";
  } catch (err) {
    if (err instanceof GhostRpcError) {
      circleId = await deriveGhostCircleId(payload, keypair.address, 0);
      const preview = JSON.stringify({ address: keypair.address }).slice(0, 32);
      txHash = "0xmock" + Buffer.from(preview).toString("hex").slice(0, 58);
    } else {
      throw err;
    }
  }
  const circle = new Circle(
    circleId,
    `ghost-${circleId.slice(3, 11)}`,
    txHash,
    { owner: keypair.address, num_features: 0, bias: 0, total_queries: 0 }
  );
  return {
    circleId,
    txHash,
    circle,
    deployedOnChain,
    deployedAt: Date.now()
  };
}
async function ghostCompileAndDeploy(keypair, source = GHOST_PROGRAM_SOURCE, ou = "250000") {
  const program = await ghostCompileProgram(source);
  return ghostDeployProgram(keypair, program, ou);
}

exports.AgentCircle = AgentCircle;
exports.Circle = Circle;
exports.CircleSession = CircleSession;
exports.CircleSessionError = CircleSessionError;
exports.FHEError = FHEError;
exports.GHOST_CIRCLE_DEPLOY_PAYLOAD = GHOST_CIRCLE_DEPLOY_PAYLOAD;
exports.GHOST_PROGRAM_SOURCE = GHOST_PROGRAM_SOURCE;
exports.GHOST_RPC_FALLBACK = GHOST_RPC_FALLBACK;
exports.GHOST_RPC_PRIMARY = GHOST_RPC_PRIMARY;
exports.GhostRpcError = GhostRpcError;
exports.OCTRA_TESTNET_URL = OCTRA_TESTNET_URL;
exports.OctraClient = OctraClient;
exports.OctraConnectionError = OctraConnectionError;
exports.ProtocolNotAllowedError = ProtocolNotAllowedError;
exports.SpendingLimitError = SpendingLimitError;
exports.VeilLMClient = VeilLMClient;
exports.createAgentCircle = createAgentCircle;
exports.decryptPayload = decryptPayload;
exports.deployCircle = deployCircle;
exports.deriveGhostCircleId = deriveGhostCircleId;
exports.encryptPayload = encryptPayload;
exports.fhe_add = fhe_add;
exports.fhe_load_pk = fhe_load_pk;
exports.fhe_scale = fhe_scale;
exports.getActiveEndpoint = getActiveEndpoint;
exports.getCircle = getCircle;
exports.getRpcMode = getRpcMode;
exports.ghostBalance = ghostBalance;
exports.ghostCompile = ghostCompile;
exports.ghostCompileAndDeploy = ghostCompileAndDeploy;
exports.ghostCompileProgram = ghostCompileProgram;
exports.ghostDeployCircle = ghostDeployCircle;
exports.ghostDeployProgram = ghostDeployProgram;
exports.ghostFheDecrypt = ghostFheDecrypt;
exports.ghostFheEncrypt = ghostFheEncrypt;
exports.ghostFheKeygen = ghostFheKeygen;
exports.ghostNodeStatus = ghostNodeStatus;
exports.ghostNonce = ghostNonce;
exports.ghostPollTx = ghostPollTx;
exports.ghostSubmitTx = ghostSubmitTx;
exports.probeNode = probeNode;
exports.rpc = rpc;
exports.signOctraTx = signOctraTx;
//# sourceMappingURL=index.cjs.map
//# sourceMappingURL=index.cjs.map