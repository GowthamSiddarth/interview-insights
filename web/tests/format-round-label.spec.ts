import { formatRoundLabel } from '../src/lib/format-round-label';

describe('formatRoundLabel (GitHub issue #287)', () => {
  it('combines type and title with " - " when a title exists', () => {
    expect(formatRoundLabel('Coding', 'Technical Screen')).toBe('Coding - Technical Screen');
  });

  it('returns just the type, with no trailing dash, when title is absent', () => {
    expect(formatRoundLabel('Coding', undefined)).toBe('Coding');
    expect(formatRoundLabel('Coding', null)).toBe('Coding');
    expect(formatRoundLabel('Coding', '')).toBe('Coding');
  });
});
