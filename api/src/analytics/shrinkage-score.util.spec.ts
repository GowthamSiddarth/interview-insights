import { computeShrinkageScore, DEFAULT_SHRINKAGE_K } from './shrinkage-score.util';

describe('computeShrinkageScore', () => {
  it('returns null below the n=3 hard floor', () => {
    expect(computeShrinkageScore(0, 4, 3)).toBeNull();
    expect(computeShrinkageScore(1, 4, 3)).toBeNull();
    expect(computeShrinkageScore(2, 4, 3)).toBeNull();
  });

  it('returns a blended score exactly matching the formula at n=3', () => {
    const n = 3;
    const companyAvg = 5;
    const globalAvg = 3;
    const k = DEFAULT_SHRINKAGE_K;
    const expected = (n / (n + k)) * companyAvg + (k / (n + k)) * globalAvg;

    expect(computeShrinkageScore(n, companyAvg, globalAvg, k)).toBeCloseTo(expected);
    // With k=8, n=3: (3/11)*5 + (8/11)*3 ≈ 3.545
    expect(computeShrinkageScore(n, companyAvg, globalAvg, k)).toBeCloseTo(3.5454545, 5);
  });

  it('converges toward companyAvg as sample size grows large', () => {
    const score = computeShrinkageScore(100_000, 5, 1);
    expect(score).toBeCloseTo(5, 2);
  });

  it('converges toward globalAvg as sample size approaches the floor from above', () => {
    // At exactly the floor (n=3) with the default k=8, global weight still
    // dominates (8/11 of the blend) — sanity check it's closer to
    // globalAvg than companyAvg here, not the other way around.
    const score = computeShrinkageScore(3, 5, 1, DEFAULT_SHRINKAGE_K)!;
    expect(Math.abs(score - 1)).toBeLessThan(Math.abs(score - 5));
  });

  it('respects a custom k', () => {
    const withDefaultK = computeShrinkageScore(5, 5, 1)!;
    const withLargerK = computeShrinkageScore(5, 5, 1, 50)!;
    // A larger k pulls harder toward globalAvg (1), so the result should be
    // smaller (closer to 1) than with the default k.
    expect(withLargerK).toBeLessThan(withDefaultK);
  });

  it('returns exactly companyAvg and globalAvg when they are equal, regardless of n', () => {
    expect(computeShrinkageScore(3, 4, 4)).toBe(4);
    expect(computeShrinkageScore(1000, 4, 4)).toBe(4);
  });
});
