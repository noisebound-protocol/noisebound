'use client';

import { useRef, useState } from 'react';
import { ethers } from 'ethers';
import {
  generatePQCKeypair,
  createBaseProvider,
  fetchNativeBalance,
  fetchERC20Balance,
  createExecutionSigner,
  getActiveNetwork,
  type PQCKeypair,
} from '@noisebound/pqc-wallet';
import {
  issueCapabilityToken,
  executeScopedTransaction,
  RevocationRegistry,
  type CapabilityToken,
} from '@noisebound/x402-pqc';

// Resolved at module load — throws immediately if NEXT_PUBLIC_NOISEBOUND_NETWORK
// is unset or unrecognized, rather than silently defaulting to mainnet.
const activeNetwork = getActiveNetwork();

export function WalletPanel() {
  const provider = useRef(createBaseProvider()).current;
  const registry = useRef(new RevocationRegistry()).current;

  const [keypair, setKeypair] = useState<PQCKeypair | null>(null);
  const [ethBalance, setEthBalance] = useState<string | null>(null);
  const [usdcBalance, setUsdcBalance] = useState<string | null>(null);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);

  const [executionSigner, setExecutionSigner] = useState<ethers.HDNodeWallet | null>(null);
  const [token, setToken] = useState<CapabilityToken | null>(null);
  const [capWei, setCapWei] = useState('10000000000000000'); // 0.01 ETH default
  const [ttlSeconds, setTtlSeconds] = useState(900);

  const [sendTo, setSendTo] = useState('');
  const [sendAmountEth, setSendAmountEth] = useState('');
  const [sendStatus, setSendStatus] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  async function handleCreateWallet() {
    const kp = generatePQCKeypair();
    setKeypair(kp);
    setExecutionSigner(null);
    setToken(null);
    setSendStatus(null);
    setSendError(null);
    await refreshBalance(kp.address);
  }

  async function refreshBalance(address?: string) {
    const addr = address ?? keypair?.address;
    if (!addr) return;
    setBalanceLoading(true);
    setBalanceError(null);
    try {
      const [wei, usdc] = await Promise.all([
        fetchNativeBalance(addr, provider),
        fetchERC20Balance(activeNetwork.usdcAddress, addr, provider),
      ]);
      setEthBalance(ethers.formatEther(wei));
      setUsdcBalance(ethers.formatUnits(usdc, 6));
    } catch (err) {
      setBalanceError(err instanceof Error ? err.message : 'balance query failed');
    } finally {
      setBalanceLoading(false);
    }
  }

  function handleIssueSessionKey() {
    if (!keypair) return;
    const signer = createExecutionSigner(provider);
    const sessionId = crypto.randomUUID();
    const newToken = issueCapabilityToken(
      keypair,
      sessionId,
      signer.address,
      [{ type: 'sign-tx', maxAmountWei: capWei }],
      ttlSeconds,
    );
    setExecutionSigner(signer);
    setToken(newToken);
    setSendStatus(null);
    setSendError(null);
  }

  function handleRevoke() {
    if (!token) return;
    registry.revoke(token.tokenId, token.expiresAt);
    setSendStatus(null);
    setSendError('session key revoked — sends will now fail closed');
  }

  async function handleSend() {
    setSendStatus(null);
    setSendError(null);
    if (!token || !executionSigner) {
      setSendError('issue a session key first');
      return;
    }
    try {
      const tx = { to: sendTo, value: ethers.parseEther(sendAmountEth || '0') };
      const response = await executeScopedTransaction(token, executionSigner, tx, registry);
      setSendStatus(`broadcast ok — tx hash ${response.hash}`);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'send failed');
    }
  }

  const tokenExpired = token ? Math.floor(Date.now() / 1000) > token.expiresAt : false;

  return (
    <div>
      <div className="row" style={{ marginBottom: '1rem' }}>
        <span
          className={activeNetwork.chainId === 8453 ? 'error' : 'ok'}
          style={{
            border: '1px solid currentColor',
            borderRadius: '999px',
            padding: '0.15rem 0.6rem',
            fontSize: '0.8rem',
            fontWeight: 'bold',
          }}
        >
          {activeNetwork.chainId === 8453 ? '⚠ ' : ''}
          {activeNetwork.displayName} (chainId {activeNetwork.chainId})
        </span>
      </div>

      <section>
        <h2>1. Wallet</h2>
        {!keypair ? (
          <button onClick={handleCreateWallet}>Create wallet</button>
        ) : (
          <>
            <p className="mono">{keypair.address}</p>
            <p className="mono">ML-DSA-65 identity key — never signs on-chain transactions directly</p>
          </>
        )}
      </section>

      {keypair && (
        <section>
          <h2>2. Balance ({activeNetwork.displayName})</h2>
          <div className="row">
            <span>ETH: {ethBalance ?? '—'}</span>
            <span>USDC: {usdcBalance ?? '—'}</span>
            <button onClick={() => refreshBalance()} disabled={balanceLoading}>
              {balanceLoading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
          {balanceError && <p className="error">{balanceError}</p>}
        </section>
      )}

      {keypair && (
        <section>
          <h2>3. Session key</h2>
          <label>
            Cap (wei)
            <input value={capWei} onChange={e => setCapWei(e.target.value)} />
          </label>
          <label>
            TTL (seconds)
            <input
              type="number"
              value={ttlSeconds}
              onChange={e => setTtlSeconds(Number(e.target.value))}
            />
          </label>
          <button onClick={handleIssueSessionKey}>Issue session key</button>
          {token && (
            <div>
              <p className="mono">execution address: {token.executionAddress}</p>
              <p className={tokenExpired ? 'error' : 'ok'}>
                {tokenExpired ? 'expired' : `expires at ${new Date(token.expiresAt * 1000).toLocaleTimeString()}`}
              </p>
              <button onClick={handleRevoke}>Revoke</button>
            </div>
          )}
        </section>
      )}

      {keypair && token && (
        <section>
          <h2>4. Send (gated through the session key)</h2>
          <input placeholder="to address" value={sendTo} onChange={e => setSendTo(e.target.value)} />
          <input
            placeholder="amount (ETH)"
            value={sendAmountEth}
            onChange={e => setSendAmountEth(e.target.value)}
          />
          <button onClick={handleSend}>Send</button>
          {sendStatus && <p className="ok">{sendStatus}</p>}
          {sendError && <p className="error">{sendError}</p>}
        </section>
      )}
    </div>
  );
}