import {
  assertSeedTargetConfirmed,
  buildTypeMetadata,
  parseIntArg,
  pickModerationOutcome,
  pickProcessCount,
} from './seed-demo-data';
import { RoundTypeSchemaWithOptions } from '../src/round-type-registry/round-type-field-options.service';

describe('seed-demo-data', () => {
  const originalEnv = process.env.DATABASE_URL;
  const originalArgv = process.argv;

  afterEach(() => {
    process.env.DATABASE_URL = originalEnv;
    process.argv = originalArgv;
    jest.restoreAllMocks();
  });

  describe('assertSeedTargetConfirmed', () => {
    it('allows a DATABASE_URL naming interview_insights_test', () => {
      process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/interview_insights_test';
      process.argv = ['node', 'seed-demo-data.ts'];
      expect(() => assertSeedTargetConfirmed()).not.toThrow();
    });

    it('refuses a different database without the override flag', () => {
      process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/interview_insights';
      process.argv = ['node', 'seed-demo-data.ts'];
      expect(() => assertSeedTargetConfirmed()).toThrow(/Refusing to seed/);
    });

    it('allows a different database when --i-know-this-seeds-fake-data is passed', () => {
      process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/interview_insights';
      process.argv = ['node', 'seed-demo-data.ts', '--i-know-this-seeds-fake-data'];
      expect(() => assertSeedTargetConfirmed()).not.toThrow();
    });
  });

  describe('parseIntArg', () => {
    it('returns the fallback when the flag is absent', () => {
      process.argv = ['node', 'seed-demo-data.ts'];
      expect(parseIntArg('--companies', 8)).toBe(8);
    });

    it('parses a valid positive integer', () => {
      process.argv = ['node', 'seed-demo-data.ts', '--companies=12'];
      expect(parseIntArg('--companies', 8)).toBe(12);
    });

    it('falls back on a non-numeric or non-positive value', () => {
      process.argv = ['node', 'seed-demo-data.ts', '--companies=abc'];
      expect(parseIntArg('--companies', 8)).toBe(8);
      process.argv = ['node', 'seed-demo-data.ts', '--companies=-3'];
      expect(parseIntArg('--companies', 8)).toBe(8);
    });
  });

  // GitHub issue #164 — the shrinkage-floor-exercising guarantee this
  // design relies on: proving the distribution is actually capable of
  // landing in all three buckets (under the n=3 floor, at/above it, well
  // above it), rather than relying on a live seed run happening to produce
  // all three by chance in the same session.
  describe('pickProcessCount', () => {
    it('returns a count under the shrinkage floor (1-2) in the low bucket', () => {
      jest.spyOn(Math, 'random').mockReturnValue(0.1);
      const count = pickProcessCount();
      expect(count).toBeGreaterThanOrEqual(1);
      expect(count).toBeLessThanOrEqual(2);
    });

    it('returns a count at/above the shrinkage floor (3-5) in the mid bucket', () => {
      jest.spyOn(Math, 'random').mockReturnValue(0.5);
      const count = pickProcessCount();
      expect(count).toBeGreaterThanOrEqual(3);
      expect(count).toBeLessThanOrEqual(5);
    });

    it('returns a count well above the floor (8-15) in the high bucket', () => {
      jest.spyOn(Math, 'random').mockReturnValue(0.9);
      const count = pickProcessCount();
      expect(count).toBeGreaterThanOrEqual(8);
      expect(count).toBeLessThanOrEqual(15);
    });
  });

  describe('pickModerationOutcome', () => {
    it.each([
      [0.1, 'approved'],
      [0.75, 'pending'],
      [0.85, 'rejected'],
      [0.95, 'flagged'],
    ])('maps random() = %s to %s', (random, expected) => {
      jest.spyOn(Math, 'random').mockReturnValue(random);
      expect(pickModerationOutcome()).toBe(expected);
    });
  });

  describe('buildTypeMetadata', () => {
    const schema: RoundTypeSchemaWithOptions = {
      coding: {
        fields: [
          { key: 'problemAlgorithms', kind: 'controlled-multi', options: ['DFS', 'BFS', 'Two Pointers'] },
          { key: 'problemDescription', kind: 'text' },
        ],
      },
    } as unknown as RoundTypeSchemaWithOptions;

    it('only picks values from the seeded active options for a controlled-multi field', () => {
      jest.spyOn(Math, 'random').mockReturnValue(0.9); // include the text field too
      const metadata = buildTypeMetadata('coding', schema);
      const values = metadata?.problemAlgorithms as string[] | undefined;
      expect(values).toBeDefined();
      for (const v of values ?? []) {
        expect(['DFS', 'BFS', 'Two Pointers']).toContain(v);
      }
    });

    it('omits a controlled field entirely when no options are seeded for it', () => {
      const emptySchema: RoundTypeSchemaWithOptions = {
        coding: { fields: [{ key: 'problemAlgorithms', kind: 'controlled-multi', options: [] }] },
      } as unknown as RoundTypeSchemaWithOptions;

      const metadata = buildTypeMetadata('coding', emptySchema);
      expect(metadata?.problemAlgorithms).toBeUndefined();
    });

    it('returns undefined when nothing ends up populated', () => {
      jest.spyOn(Math, 'random').mockReturnValue(0.99); // skip the coin-flip text field
      const emptySchema: RoundTypeSchemaWithOptions = {
        coding: { fields: [{ key: 'problemDescription', kind: 'text' }] },
      } as unknown as RoundTypeSchemaWithOptions;

      const metadata = buildTypeMetadata('coding', emptySchema);
      expect(metadata).toBeUndefined();
    });
  });
});
