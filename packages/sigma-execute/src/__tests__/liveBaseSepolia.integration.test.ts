import { JsonRpcProvider, Wallet } from 'ethers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SystemClock, confirmEscalation } from '@noisebound/sigma-core';
import { generateIdentityKeyPair } from '@noisebound/identity';
import { createRevocationRegistry, issueSessionCapability } from '@noisebound/pqc-wallet';
import { evaluateAction } from '../evaluate.js';
import { executeConfirmedAction } from '../execute.js';
import { createEthersOnChainExecutor } from '../onChainExecutor.js';
import type { ExecutionRegistry, OnChainMoneyActionRequest } from '../types.js';

const NETWORK_ENV_VAR = 'NEXT_PUBLIC_NOISEBOUND_NETWORK';
const PRIVATE_KEY_ENV_VAR = 'NOISEBOUND_LIVE_TEST_PRIVATE_KEY';
const RPC_URL = 'https://sepolia.base.org';
const CHAIN_ID = 84532;

/** Dust self-transfer â€” small enough that any funded test key can afford it repeatedly. */
const TRANSFER_AMOUNT_WEI = 1_000n;
/** Conservative floor so a near-empty key fails with a clear message, not a confusing RPC error. */
const MIN_BALANCE_WEI = 20_000_000_000_000n; // ~0.00002 ETH — Base Sepolia gas is near-zero; this is ~20x the self-transfer amount, not a real cost estimate

const funderPrivateKey = process.env[PRIVATE_KEY_ENV_VAR];
const originalNetworkEnv = process.env[NETWORK_ENV_VAR];

if (!funderPrivateKey) {
  // eslint-disable-next-line no-console
  console.warn(
    `[liveBaseSepolia.integration.test] Skipping: set ${PRIVATE_KEY_ENV_VAR} to a funded ` +
      `Base Sepolia private key (get testnet ETH from a Base Sepolia faucet) to run this test.`,
  );
}

/**
 * Exercises the real money-execution path against a live Base Sepolia
 * broadcast: the same request shape ActionTriggerForm builds, run through
 * evaluateAction (awaiting-confirmation), sigma-core's confirmEscalation
 * (the human-confirmation step), executeConfirmedAction (capability
 * re-validation + routing), and finally the real OnChainExecutor â€” which
 * signs with a live secp256k1 key and broadcasts to Base Sepolia over its
 * public RPC. Nothing here mocks the RPC transport; this is the one place
 * in the suite that actually leaves the machine.
 *
 * Skipped (not failed) unless NOISEBOUND_LIVE_TEST_PRIVATE_KEY is set, so
 * `pnpm test` stays green and offline for everyone who hasn't provisioned a
 * funded Base Sepolia key. Run explicitly with the env var set to exercise
 * it: `NOISEBOUND_LIVE_TEST_PRIVATE_KEY=0x... pnpm --filter @noisebound/sigma-execute test`.
 */
describe.skipIf(!funderPrivateKey)('full money-execution path â€” live Base Sepolia broadcast', () => {
  beforeEach(() => {
    process.env[NETWORK_ENV_VAR] = 'base-sepolia';
  });

  afterEach(() => {
    if (originalNetworkEnv === undefined) {
      delete process.env[NETWORK_ENV_VAR];
    } else {
      process.env[NETWORK_ENV_VAR] = originalNetworkEnv;
    }
  });

  it(
    'signs, broadcasts, and confirms a real transaction, then reflects the new state on-chain',
    async () => {
      const provider = new JsonRpcProvider(RPC_URL, CHAIN_ID);
      const funderWallet = new Wallet(funderPrivateKey as string);
      const sessionAddress = funderWallet.address as `0x${string}`;
      const sessionKey = {
        address: sessionAddress,
        publicKey: funderWallet.signingKey.publicKey,
        privateKey: funderWallet.privateKey as `0x${string}`,
      };

      const balanceBefore = await provider.getBalance(sessionAddress);
      if (balanceBefore < MIN_BALANCE_WEI) {
        throw new Error(
          `Session address ${sessionAddress} (from ${PRIVATE_KEY_ENV_VAR}) has only ` +
            `${balanceBefore.toString()} wei on Base Sepolia â€” needs at least ` +
            `${MIN_BALANCE_WEI.toString()} wei. Fund it from a Base Sepolia faucet and retry.`,
        );
      }
      const nonceBefore = await provider.getTransactionCount(sessionAddress, 'latest');

      // Real ML-DSA-65 identity issuing a real signed capability scoped to
      // this session key, mirroring how the app issues capabilities for real.
      const identityKeyPair = generateIdentityKeyPair();
      const capability = issueSessionCapability(
        identityKeyPair,
        funderWallet.signingKey.publicKey,
        { maxSpendWei: (TRANSFER_AMOUNT_WEI * 10n).toString() },
        5 * 60_000,
      );

      // Same shape ActionTriggerForm builds for a 'Send' submission.
      const request: OnChainMoneyActionRequest = {
        kind: 'on-chain-money',
        id: `live-sepolia-${Date.now()}`,
        description: `Send ${TRANSFER_AMOUNT_WEI.toString()} wei to ${sessionAddress}`,
        amountCents: 1,
        currency: 'USD',
        amountWei: TRANSFER_AMOUNT_WEI,
        recipient: sessionAddress, // self-transfer: only cost is gas, easy to assert on
        asset: 'ETH',
      };

      const clock = new SystemClock();

      const evaluated = evaluateAction(request, clock);
      expect(evaluated.status).toBe('awaiting-confirmation');
      if (evaluated.status !== 'awaiting-confirmation') return;

      // The human-confirmation step: sigma-core only turns this into 'allow'
      // once a human has actually confirmed the exact payload rendered above.
      const confirmed = confirmEscalation(
        { category: 'money', id: request.id, description: request.description, amountCents: request.amountCents, currency: request.currency, amountWei: request.amountWei },
        { confirmed: true },
      );
      expect(confirmed).toBe('allow');

      const registry: ExecutionRegistry = {
        identityPublicKey: identityKeyPair.publicKey,
        revocationRegistry: createRevocationRegistry(),
        onChain: createEthersOnChainExecutor((address) =>
          address === sessionKey.address ? sessionKey : undefined,
        ),
        issuerPublicKey: undefined as unknown as ExecutionRegistry['issuerPublicKey'],
        redemptionRegistry: undefined as unknown as ExecutionRegistry['redemptionRegistry'],
      };

      const outcome = await executeConfirmedAction(request, capability, registry, clock);

      expect(outcome.status).toBe('executed');
      if (outcome.status !== 'executed' || outcome.result.kind !== 'on-chain-money') {
        throw new Error(`Expected an executed on-chain-money outcome, got: ${JSON.stringify(outcome)}`);
      }

      const { txHash } = outcome.result;
      expect(txHash).toMatch(/^0x[0-9a-fA-F]{64}$/);

      const receipt = await provider.waitForTransaction(txHash, 1, 120_000);
      expect(receipt).not.toBeNull();
      expect(receipt?.status).toBe(1);

      const [balanceAfter, nonceAfter] = await Promise.all([
        provider.getBalance(sessionAddress),
        provider.getTransactionCount(sessionAddress, 'latest'),
      ]);

      expect(nonceAfter).toBe(nonceBefore + 1);
      // Self-transfer: the sent value comes right back, so only fees are spent.
      // Note: Base (OP-Stack L2) charges an L1 data-posting fee on top of L2
      // execution gas (gasUsed * gasPrice), so the exact total cost cannot be
      // predicted from the receipt alone. Assert the balance moved in the
      // right direction and by a sane bounded amount instead of an exact figure.
      const totalFeePaid = balanceBefore - balanceAfter;
      expect(totalFeePaid).toBeGreaterThan(0n);
      expect(totalFeePaid).toBeLessThan(MIN_BALANCE_WEI); // sanity: fee should not eat the whole funding floor
    },
    150_000,
  );
});

