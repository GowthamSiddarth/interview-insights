import { hashEmail } from './email-hash.util';

describe('hashEmail', () => {
  it('produces the same hash regardless of case or surrounding whitespace', () => {
    const a = hashEmail('Candidate@Example.com', 'secret');
    const b = hashEmail('  candidate@example.com  ', 'secret');
    expect(a).toBe(b);
  });

  it('produces different hashes for different emails', () => {
    const a = hashEmail('one@example.com', 'secret');
    const b = hashEmail('two@example.com', 'secret');
    expect(a).not.toBe(b);
  });

  it('produces different hashes for the same email under different secrets', () => {
    const a = hashEmail('candidate@example.com', 'secret-one');
    const b = hashEmail('candidate@example.com', 'secret-two');
    expect(a).not.toBe(b);
  });

  it('never contains the raw email as a substring', () => {
    const hash = hashEmail('candidate@example.com', 'secret');
    expect(hash).not.toContain('candidate');
    expect(hash).not.toContain('example.com');
  });
});
