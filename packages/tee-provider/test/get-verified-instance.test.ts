import { describe, expect, it } from 'vitest';
import { DEFAULT_MOCK_MEASUREMENT, type MeasurementAllowlist } from '@noisebound/attest';
import { getVerifiedInstance, routeVerifiedRequest, UnverifiedInstanceError } from '../src/get-verified-instance.js';
import { MockTeeProvider, buildMockTeeInstance, createMockTeeSignatureVerifier } from '../src/mock-provider.js';
import { FakeClock } from './fake-clock.js';

const NONCE = 'test-challenge-nonce';
const MAX_AGE_MS = 60_000;

const EXPECTED_MEASUREMENTS: MeasurementAllowlist = [
  {
    name: DEFAULT_MOCK_MEASUREMENT.name,
    algorithm: DEFAULT_MOCK_MEASUREMENT.algorithm,
    allowedValues: [DEFAULT_MOCK_MEASUREMENT.value],
  },
];

function verificationOptions(clock: FakeClock) {
  return {
    expectedNonce: NONCE,
    maxAgeMs: MAX_AGE_MS,
    clock,
    signatureVerifier: createMockTeeSignatureVerifier(),
  };
}

describe('getVerifiedInstance', () => {
  it('filters out instances with invalid or failed attestation', async () => {
    const clock = new FakeClock(1_000_000);
    const valid = buildMockTeeInstance({ id: 'valid-1', clock, nonce: NONCE });
    const badSignature = buildMockTeeInstance({ id: 'bad-sig', clock, nonce: NONCE, signingKey: 'attacker-key' });
    const badMeasurement = buildMockTeeInstance({
      id: 'bad-measurement',
      clock,
      nonce: NONCE,
      claimsOverrides: { measurements: [{ ...DEFAULT_MOCK_MEASUREMENT, value: 'b'.repeat(64) }] },
    });
    const provider = new MockTeeProvider([valid, badSignature, badMeasurement]);

    const result = await getVerifiedInstance(provider, EXPECTED_MEASUREMENTS, {
      verification: verificationOptions(clock),
    });

    expect(result.status).toBe('selected');
    if (result.status !== 'selected') throw new Error('unreachable');
    expect(result.session.instance.id).toBe('valid-1');
    expect(result.session.verifiedInstanceIds.has('bad-sig')).toBe(false);
    expect(result.session.verifiedInstanceIds.has('bad-measurement')).toBe(false);
  });

  it('fails closed: never selects an unverified instance even when it is the only one in the pool', async () => {
    const clock = new FakeClock(1_000_000);
    const onlyInstance = buildMockTeeInstance({ id: 'only-one', clock, nonce: NONCE, signingKey: 'attacker-key' });
    const provider = new MockTeeProvider([onlyInstance]);

    const result = await getVerifiedInstance(provider, EXPECTED_MEASUREMENTS, {
      verification: verificationOptions(clock),
    });

    expect(result.status).toBe('no_verified_instance');
    if (result.status !== 'no_verified_instance') throw new Error('unreachable');
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]?.instanceId).toBe('only-one');
    expect(result.rejected[0]?.reasons.length).toBeGreaterThan(0);
  });

  it('selects among multiple valid instances when several pass attestation', async () => {
    const clock = new FakeClock(1_000_000);
    const first = buildMockTeeInstance({ id: 'valid-a', region: 'us-east-1', clock, nonce: NONCE });
    const second = buildMockTeeInstance({ id: 'valid-b', region: 'eu-west-1', clock, nonce: NONCE });
    const provider = new MockTeeProvider([first, second]);

    const result = await getVerifiedInstance(provider, EXPECTED_MEASUREMENTS, {
      criteria: { region: 'eu-west-1' },
      verification: verificationOptions(clock),
    });

    expect(result.status).toBe('selected');
    if (result.status !== 'selected') throw new Error('unreachable');
    expect(result.session.instance.id).toBe('valid-b');
    expect(result.session.verifiedInstanceIds.size).toBe(2);
  });

  it('returns no_verified_instance when the pool is empty', async () => {
    const clock = new FakeClock(1_000_000);
    const provider = new MockTeeProvider([]);

    const result = await getVerifiedInstance(provider, EXPECTED_MEASUREMENTS, {
      verification: verificationOptions(clock),
    });

    expect(result.status).toBe('no_verified_instance');
  });
});

describe('routeVerifiedRequest', () => {
  it('routes to an instance that was actually verified', async () => {
    const clock = new FakeClock(1_000_000);
    const valid = buildMockTeeInstance({ id: 'valid-1', clock, nonce: NONCE });
    const provider = new MockTeeProvider([valid]);

    const result = await getVerifiedInstance(provider, EXPECTED_MEASUREMENTS, {
      verification: verificationOptions(clock),
    });
    if (result.status !== 'selected') throw new Error('expected selection to succeed');

    const response = await routeVerifiedRequest(result.session, 'valid-1', { body: { prompt: 'hello' } });
    expect(response.statusCode).toBe(200);
  });

  it('rejects routing to an instance id that was filtered out for failing attestation', async () => {
    const clock = new FakeClock(1_000_000);
    const valid = buildMockTeeInstance({ id: 'valid-1', clock, nonce: NONCE });
    const badSignature = buildMockTeeInstance({ id: 'bad-sig', clock, nonce: NONCE, signingKey: 'attacker-key' });
    const provider = new MockTeeProvider([valid, badSignature]);

    const result = await getVerifiedInstance(provider, EXPECTED_MEASUREMENTS, {
      verification: verificationOptions(clock),
    });
    if (result.status !== 'selected') throw new Error('expected selection to succeed');

    await expect(routeVerifiedRequest(result.session, 'bad-sig', { body: {} })).rejects.toThrow(
      UnverifiedInstanceError,
    );
  });

  it('rejects routing to an instance id that never existed in the provider pool at all', async () => {
    const clock = new FakeClock(1_000_000);
    const valid = buildMockTeeInstance({ id: 'valid-1', clock, nonce: NONCE });
    const provider = new MockTeeProvider([valid]);

    const result = await getVerifiedInstance(provider, EXPECTED_MEASUREMENTS, {
      verification: verificationOptions(clock),
    });
    if (result.status !== 'selected') throw new Error('expected selection to succeed');

    await expect(routeVerifiedRequest(result.session, 'nonexistent', { body: {} })).rejects.toThrow(
      UnverifiedInstanceError,
    );
  });
});
