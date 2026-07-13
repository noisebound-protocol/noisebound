import type { UserContext } from '../parser/types.js';

export interface DeidentificationVault {
  [placeholder: string]: string;
}

export interface DeidentificationResult {
  sanitized: string;
  vault: DeidentificationVault;
}

export const KNOWN_TOKENS = [
  'USDC', 'USDT', 'DAI', 'ETH', 'WETH', 'WBTC', 'CBBTC', 'CBETH',
  'OCT', 'AERO', 'WELL',
] as const;

// Longest token symbol first so alternation matches greedily (CBBTC before BTC, WETH before ETH)
const TOKEN_ALT = [...KNOWN_TOKENS].sort((a, b) => b.length - a.length).join('|');

// Ordered most-specific first: 64-hex TX hashes before 40-hex wallet addresses.
// Each pattern uses a negative lookahead so a longer hex string is not partially matched.
const PATTERNS: Array<{ regex: RegExp; type: string }> = [
  { regex: /0x[0-9a-fA-F]{64}(?![0-9a-fA-F])/g, type: 'TX_HASH' },
  { regex: /0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g, type: 'WALLET' },
  { regex: /\b[a-zA-Z0-9][a-zA-Z0-9-]*\.eth\b/g, type: 'ENS' },
  { regex: new RegExp(`\\d+(?:\\.\\d+)?\\s*(?:${TOKEN_ALT})\\b`, 'g'), type: 'AMOUNT' },
  { regex: /\$\d[\d,]*(?:\.\d+)?/g, type: 'USD' },
];

export class DeidentificationPipeline {
  /**
   * Replaces sensitive patterns with opaque placeholders. Pre-seeds vault
   * from UserContext so context.address and non-zero balances get deterministic
   * placeholder assignment when they appear in the message.
   * Bare numeric amounts without a known token suffix are intentionally not stripped.
   */
  deidentify(message: string, context: UserContext): DeidentificationResult {
    const vault: DeidentificationVault = {};
    const counters: Record<string, number> = {};
    // normalized (lowercased) match value → existing placeholder
    const reverse = new Map<string, string>();

    // Pre-seed: context address gets WALLET_0 when encountered
    if (context.address) {
      counters['WALLET'] = 1;
      vault['[WALLET_0]'] = context.address;
      reverse.set(context.address.toLowerCase(), '[WALLET_0]');
    }

    // Pre-seed: non-zero balances as AMOUNT_n
    let amountIdx = 0;
    for (const [token, rawAmount] of Object.entries(context.balances)) {
      if (!rawAmount || parseFloat(rawAmount) === 0) continue;
      const placeholder = `[AMOUNT_${amountIdx}]`;
      vault[placeholder] = `${rawAmount} ${token}`;
      // Match both spaced ("1.5 ETH") and unspaced ("1.5ETH") forms
      reverse.set(`${rawAmount} ${token}`.toLowerCase(), placeholder);
      reverse.set(`${rawAmount}${token}`.toLowerCase(), placeholder);
      amountIdx++;
    }
    counters['AMOUNT'] = amountIdx;

    const getPlaceholder = (type: string, match: string): string => {
      const key = match.toLowerCase();
      const existing = reverse.get(key);
      if (existing) return existing;
      const idx = counters[type] ?? 0;
      counters[type] = idx + 1;
      const placeholder = `[${type}_${idx}]`;
      vault[placeholder] = match;
      reverse.set(key, placeholder);
      return placeholder;
    };

    let sanitized = message;
    for (const { regex, type } of PATTERNS) {
      sanitized = sanitized.replace(regex, (match) => getPlaceholder(type, match));
    }

    return { sanitized, vault };
  }

  /**
   * Restores placeholders to their original values. Sorts longest placeholder
   * first so [AMOUNT_10] is replaced before [AMOUNT_1] in case of overlap.
   */
  reidentify(response: string, vault: DeidentificationVault): string {
    const sorted = Object.keys(vault).sort((a, b) => b.length - a.length);
    let result = response;
    for (const placeholder of sorted) {
      result = result.split(placeholder).join(vault[placeholder]);
    }
    return result;
  }
}
