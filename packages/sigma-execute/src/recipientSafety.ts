import { isAddress } from 'ethers';

/**
 * Machine-readable reason a recipient was flagged. Any non-null value here
 * is treated by sigma-core's `evaluateEscalation` as disqualifying — see
 * {@link MoneyEscalationRequest.flaggedPattern}.
 */
export type FlaggedRecipientPattern = 'invalid-address' | 'burn-address-zero' | 'burn-address-dead';

/**
 * The deterministic, offline signal a recipient-safety guard produces for a
 * single money recipient. Consumed directly by sigma-core's
 * `MoneyEscalationRequest` (`isKnownRecipient`/`flaggedPattern` fields) —
 * this is not a parallel schema.
 */
export interface RecipientSafetySignal {
  readonly isKnownRecipient: boolean | undefined;
  readonly flaggedPattern: FlaggedRecipientPattern | null;
}

/**
 * Tracks which recipient addresses a user/session has previously sent to.
 * Deliberately a plain interface (not tied to any storage) so callers can
 * back it with whatever persistence fits their session model; sigma-execute
 * only ships an in-memory reference implementation.
 */
export interface RecipientHistory {
  hasSeen(recipient: string): boolean;
  markSeen(recipient: string): void;
}

function normalize(address: string): string {
  return address.toLowerCase();
}

/** In-memory `RecipientHistory` keyed by lowercased address. Not persisted across process restarts. */
export function createInMemoryRecipientHistory(seed: Iterable<string> = []): RecipientHistory {
  const seen = new Set<string>();
  for (const address of seed) {
    seen.add(normalize(address));
  }

  return {
    hasSeen(recipient: string): boolean {
      return seen.has(normalize(recipient));
    },
    markSeen(recipient: string): void {
      seen.add(normalize(recipient));
    },
  };
}

const ZERO_ADDRESS_PATTERN = /^0x0{40}$/i;
// The widely-documented "dead" burn address, e.g. 0x000000000000000000000000000000000000dEaD.
const DEAD_ADDRESS_PATTERN = /^0x0{36}dead$/i;

function detectBurnPattern(address: string): FlaggedRecipientPattern | null {
  if (ZERO_ADDRESS_PATTERN.test(address)) {
    return 'burn-address-zero';
  }
  if (DEAD_ADDRESS_PATTERN.test(address)) {
    return 'burn-address-dead';
  }
  return null;
}

/**
 * Deterministic pre-check for a money recipient: no model call, no network
 * call, safe to run on every money action before it ever reaches escalation
 * or on-chain execution.
 *
 * Format/checksum validation and burn-address pattern matching always run.
 * The novelty check only runs if a `history` is supplied — without one,
 * `isKnownRecipient` comes back `undefined` (no opinion), preserving
 * existing callers' behavior until they opt into novelty tracking by
 * passing a `RecipientHistory`.
 */
export function checkRecipientSafety(recipient: string, history?: RecipientHistory): RecipientSafetySignal {
  const isKnownRecipient = history ? history.hasSeen(recipient) : undefined;

  if (!isAddress(recipient)) {
    return { isKnownRecipient, flaggedPattern: 'invalid-address' };
  }

  return { isKnownRecipient, flaggedPattern: detectBurnPattern(recipient) };
}
