import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { EmptyState } from '../src/components/EmptyState';

describe('EmptyState', () => {
  it('renders the given message', () => {
    render(<EmptyState message="No matches for this search." />);
    expect(screen.getByText('No matches for this search.')).toBeInTheDocument();
  });

  // GitHub issue #614 — a generic icon across every call site, hidden
  // from assistive tech since the message text alone already conveys
  // the meaning (the icon is reinforcement, not information).
  it('renders an icon that is hidden from assistive tech', () => {
    const { container } = render(<EmptyState message="Queue is clear." />);
    const icon = container.querySelector('svg');
    expect(icon).toBeInTheDocument();
    expect(icon).toHaveAttribute('aria-hidden', 'true');
  });
});
