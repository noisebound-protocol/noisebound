import { describe, expect, it } from 'vitest';
import { checkRecipientSafety, createInMemoryRecipientHistory } from '../recipientSafety.js';

const ORDINARY_ADDRESS = '0x4f2a1b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a';

describe('checkRecipientSafety', () => {
  describe('burn-address detection', () => {
    it('flags the zero address', () => {
      const signal = checkRecipientSafety('0x0000000000000000000000000000000000000000');
      expect(signal.flaggedPattern).toBe('burn-address-zero');
    });

    it('flags the well-known dead/burn address', () => {
      const signal = checkRecipientSafety('0x000000000000000000000000000000000000dead');
      expect(signal.flaggedPattern).toBe('burn-address-dead');
    });

    it('flags the dead/burn address regardless of case', () => {
      const signal = checkRecipientSafety('0x000000000000000000000000000000000000DEAD');
      expect(signal.flaggedPattern).toBe('burn-address-dead');
    });

    it('does not flag an ordinary address that merely contains zeros', () => {
      const signal = checkRecipientSafety('0x000000000000000000000000000000000000f00d');
      expect(signal.flaggedPattern).toBeNull();
    });
  });

  describe('malformed / invalid-checksum addresses', () => {
    it('flags an address that is too short', () => {
      const signal = checkRecipientSafety('0x1234');
      expect(signal.flaggedPattern).toBe('invalid-address');
    });

    it('flags an address with non-hex characters', () => {
      const signal = checkRecipientSafety('0xnotarealaddress000000000000000000000000');
      expect(signal.flaggedPattern).toBe('invalid-address');
    });

    it('flags an address with an invalid mixed-case checksum', () => {
      // Same digits as ORDINARY_ADDRESS but with casing that doesn't match
      // the EIP-55 checksum for that address.
      const signal = checkRecipientSafety('0x4F2a1b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a');
      expect(signal.flaggedPattern).toBe('invalid-address');
    });

    it('does not flag a valid all-lowercase address', () => {
      const signal = checkRecipientSafety(ORDINARY_ADDRESS);
      expect(signal.flaggedPattern).toBeNull();
    });
  });

  describe('novelty gate', () => {
    it('reports isKnownRecipient as undefined when no history is supplied', () => {
      const signal = checkRecipientSafety(ORDINARY_ADDRESS);
      expect(signal.isKnownRecipient).toBeUndefined();
    });

    it('reports isKnownRecipient false for a first-time-seen valid address', () => {
      const history = createInMemoryRecipientHistory();
      const signal = checkRecipientSafety(ORDINARY_ADDRESS, history);
      expect(signal.isKnownRecipient).toBe(false);
      expect(signal.flaggedPattern).toBeNull();
    });

    it('reports isKnownRecipient true for a previously-seen valid address', () => {
      const history = createInMemoryRecipientHistory([ORDINARY_ADDRESS]);
      const signal = checkRecipientSafety(ORDINARY_ADDRESS, history);
      expect(signal.isKnownRecipient).toBe(true);
    });

    it('recognizes a previously-seen address regardless of case', () => {
      const history = createInMemoryRecipientHistory([ORDINARY_ADDRESS.toUpperCase().replace('0X', '0x')]);
      const signal = checkRecipientSafety(ORDINARY_ADDRESS, history);
      expect(signal.isKnownRecipient).toBe(true);
    });

    it('marks an address as seen going forward once markSeen is called', () => {
      const history = createInMemoryRecipientHistory();
      expect(checkRecipientSafety(ORDINARY_ADDRESS, history).isKnownRecipient).toBe(false);

      history.markSeen(ORDINARY_ADDRESS);

      expect(checkRecipientSafety(ORDINARY_ADDRESS, history).isKnownRecipient).toBe(true);
    });

    it('does not consider one address seen just because a different address was seen', () => {
      const history = createInMemoryRecipientHistory(['0x1111111111111111111111111111111111111111']);
      const signal = checkRecipientSafety(ORDINARY_ADDRESS, history);
      expect(signal.isKnownRecipient).toBe(false);
    });
  });
});
