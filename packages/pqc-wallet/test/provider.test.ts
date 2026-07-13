import { describe, it, expect } from 'vitest';
import { ethers } from 'ethers';
import { generatePQCKeypair } from '../src/keypair.js';
import { WalletProvider } from '../src/provider.js';

describe('WalletProvider', () => {
  it('getAddress() returns the keypair address', async () => {
    const keypair = generatePQCKeypair();
    const wallet = new WalletProvider(keypair);
    expect(await wallet.getAddress()).toBe(keypair.address);
  });

  it('signs a mock Base transaction correctly', async () => {
    const keypair = generatePQCKeypair();
    const wallet = new WalletProvider(keypair);

    const tx: ethers.TransactionRequest = {
      to: '0x000000000000000000000000000000000000dEaD',
      value: ethers.parseEther('0.001'),
      chainId: 8453,
      gasLimit: 21000n,
      maxFeePerGas: ethers.parseUnits('1', 'gwei'),
      maxPriorityFeePerGas: ethers.parseUnits('1', 'gwei'),
      nonce: 0,
      type: 2,
    };

    const signed = await wallet.signTransaction(tx);
    expect(signed).toMatch(/^0x[0-9a-f]+$/i);
    // ML-DSA-65 signatures are 3309 bytes → 6618 hex chars + '0x'
    expect(signed.length).toBeGreaterThan(6000);
  });

  it('signMessage returns a hex-encoded ML-DSA-65 signature', async () => {
    const keypair = generatePQCKeypair();
    const wallet = new WalletProvider(keypair);

    const sig = await wallet.signMessage('hello veil');
    expect(sig).toMatch(/^0x[0-9a-f]+$/i);
    expect(sig.length).toBeGreaterThan(6000);
  });

  it('connect() returns a new WalletProvider with the same keypair', async () => {
    const keypair = generatePQCKeypair();
    const wallet = new WalletProvider(keypair);
    const connected = wallet.connect(null);

    expect(await connected.getAddress()).toBe(await wallet.getAddress());
    expect(connected).not.toBe(wallet);
  });

  it('signTypedData returns a hex-encoded ML-DSA-65 signature', async () => {
    const keypair = generatePQCKeypair();
    const wallet = new WalletProvider(keypair);

    const domain = { name: 'Veil', version: '1', chainId: 8453 };
    const types = { Payment: [{ name: 'amount', type: 'uint256' }] };
    const value = { amount: ethers.parseEther('1') };

    const sig = await wallet.signTypedData(domain, types, value);
    expect(sig).toMatch(/^0x[0-9a-f]+$/i);
  });
});
