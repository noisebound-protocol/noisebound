import { describe, expect, it } from 'vitest';
import { buildAllScenarios, checkSafetyFloors, SAFETY_FLOOR_GROUPS } from '../scenarios.js';

describe('checkSafetyFloors', () => {
  const scenarios = buildAllScenarios();

  it('every safety floor group matches at least one scenario id prefix', () => {
    // Guards against a typo'd/renamed builder id silently zeroing out a group
    // rather than tripping the floor check below.
    const ids = scenarios.map((s) => s.id);
    for (const group of SAFETY_FLOOR_GROUPS) {
      for (const prefix of group.idPrefixes) {
        expect(ids.some((id) => id.startsWith(prefix)), `${group.name}: no scenario id starts with "${prefix}"`).toBe(true);
      }
    }
  });

  it('holds every safety-critical category floor as the dataset stands today', () => {
    const violations = checkSafetyFloors(scenarios);
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  });

  it('flags a violation when a safety-critical group is diluted by growth elsewhere', () => {
    // Simulate scaling a non-safety category way up without touching a
    // safety-critical group — this is exactly the dilution scenario the
    // floors exist to catch.
    const padding = Array.from({ length: 400 }, (_, i) => ({
      id: `synthetic-padding-${i}`,
      category: 'scoped-send' as const,
      terminalOutcome: 'awaiting-confirmation' as const,
      steps: [],
    }));
    const violations = checkSafetyFloors([...scenarios, ...padding]);
    expect(violations.length).toBeGreaterThan(0);
  });
});
