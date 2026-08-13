import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { StatusPill } from '../src/components/StatusPill';

describe('StatusPill', () => {
  it('renders its label as text', () => {
    render(<StatusPill tone="good">Approved</StatusPill>);
    expect(screen.getByText('Approved')).toBeInTheDocument();
  });

  // GitHub issue #620 — text color comes from each tone's -ink variant,
  // never the raw hue — the raw warning/serious hexes fail as text
  // color outright (1.79/2.57:1 on a light surface, per the dataviz
  // skill's own palette reference).
  it.each([
    ['good', 'var(--status-good-ink)'],
    ['warning', 'var(--status-warning-ink)'],
    ['serious', 'var(--status-serious-ink)'],
    ['critical', 'var(--status-critical-ink)'],
  ] as const)('uses the %s tone\'s -ink variant for text color', (tone, expectedColor) => {
    render(<StatusPill tone={tone}>x</StatusPill>);
    expect(screen.getByText('x')).toHaveStyle({ color: expectedColor });
  });

  it('pairs the label with a visible icon, hidden from assistive tech (the label alone already conveys the state)', () => {
    const { container } = render(<StatusPill tone="critical">Rejected</StatusPill>);
    const icon = container.querySelector('svg');
    expect(icon).toBeInTheDocument();
    expect(icon).toHaveAttribute('aria-hidden', 'true');
  });
});
