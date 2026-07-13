import { describe, it, expect } from 'vitest';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa';
import { generatePQCKeypair } from '../src/keypair.js';
import { signTransaction, verifyTransactionSignature } from '../src/signing.js';
import { ethers } from 'ethers';

const mockTx: ethers.TransactionLike = {
  to: '0x000000000000000000000000000000000000dEaD',
  value: ethers.parseEther('0.001'),
  chainId: 8453,
  gasLimit: 21000n,
  maxFeePerGas: ethers.parseUnits('1', 'gwei'),
  maxPriorityFeePerGas: ethers.parseUnits('1', 'gwei'),
  nonce: 0,
  type: 2,
};

describe('sign and verify roundtrip', () => {
  it('signs a message with ML-DSA-65 and verifies', () => {
    const { signingKey, publicKey } = generatePQCKeypair();
    const msg = new TextEncoder().encode('hello veil');

    const sig = ml_dsa65.sign(signingKey, msg);
    expect(ml_dsa65.verify(publicKey.dsa, msg, sig)).toBe(true);
  });

  it('rejects a signature over a different message', () => {
    const { signingKey, publicKey } = generatePQCKeypair();
    const sig = ml_dsa65.sign(signingKey, new TextEncoder().encode('hello'));
    expect(ml_dsa65.verify(publicKey.dsa, new TextEncoder().encode('world'), sig)).toBe(false);
  });

  it('signTransaction returns a Uint8Array signature', () => {
    const { signingKey } = generatePQCKeypair();
    const sig = signTransaction(mockTx, signingKey);
    expect(sig).toBeInstanceOf(Uint8Array);
    // ML-DSA-65 signatures are 3309 bytes
    expect(sig.length).toBeGreaterThan(3000);
  });

  it('signTransaction + verifyTransactionSignature roundtrip', () => {
    const { signingKey, publicKey } = generatePQCKeypair();
    const sig = signTransaction(mockTx, signingKey);
    expect(verifyTransactionSignature(mockTx, sig, publicKey.dsa)).toBe(true);
  });

  it('verifyTransactionSignature rejects a signature from a different keypair', () => {
    const { signingKey } = generatePQCKeypair();
    const { publicKey: otherPub } = generatePQCKeypair();
    const sig = signTransaction(mockTx, signingKey);
    expect(verifyTransactionSignature(mockTx, sig, otherPub.dsa)).toBe(false);
  });
});
