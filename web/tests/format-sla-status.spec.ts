import { formatSlaStatus } from '../src/lib/format-sla-status';

describe('formatSlaStatus (GitHub issue #490)', () => {
  const now = new Date('2026-08-04T12:00:00Z');

  it('reports minutes remaining under an hour', () => {
    expect(formatSlaStatus('2026-08-04T12:30:00Z', now)).toEqual({ label: 'Due in 30m', overdue: false });
  });

  it('reports hours remaining under a day', () => {
    expect(formatSlaStatus('2026-08-04T18:00:00Z', now)).toEqual({ label: 'Due in 6h', overdue: false });
  });

  it('reports days remaining at 24h or more', () => {
    expect(formatSlaStatus('2026-08-06T12:00:00Z', now)).toEqual({ label: 'Due in 2d', overdue: false });
  });

  it('marks the exact deadline instant as overdue (by 0, floored to 1m)', () => {
    expect(formatSlaStatus('2026-08-04T12:00:00Z', now)).toEqual({ label: 'Overdue by 1m', overdue: true });
  });

  it('reports how far overdue an already-breached entry is', () => {
    expect(formatSlaStatus('2026-08-04T09:00:00Z', now)).toEqual({ label: 'Overdue by 3h', overdue: true });
  });

  it('reports overdue in days once breached long enough', () => {
    expect(formatSlaStatus('2026-08-01T12:00:00Z', now)).toEqual({ label: 'Overdue by 3d', overdue: true });
  });
});
