import { hashRecruiterIdentifier } from './recruiter-identifier-hash.util';

describe('hashRecruiterIdentifier', () => {
  it('produces the same hash regardless of case or surrounding whitespace', () => {
    const a = hashRecruiterIdentifier('  Jane Doe  ', 'secret');
    const b = hashRecruiterIdentifier('jane doe', 'secret');
    expect(a).toBe(b);
  });

  it('produces different hashes for different identifiers', () => {
    const a = hashRecruiterIdentifier('jane doe', 'secret');
    const b = hashRecruiterIdentifier('john smith', 'secret');
    expect(a).not.toBe(b);
  });

  it('produces different hashes for the same identifier under a different secret', () => {
    const a = hashRecruiterIdentifier('jane doe', 'secret-1');
    const b = hashRecruiterIdentifier('jane doe', 'secret-2');
    expect(a).not.toBe(b);
  });
});
