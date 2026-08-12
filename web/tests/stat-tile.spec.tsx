import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { StatTile } from '../src/components/StatTile';

describe('StatTile', () => {
  it('renders the value (2 decimals), label, and sample size', () => {
    render(<StatTile label="Difficulty" value={3.5} sampleSize={5} />);
    expect(screen.getByText('3.50')).toBeInTheDocument();
    expect(screen.getByText('Difficulty')).toBeInTheDocument();
    expect(screen.getByText('5 reviews')).toBeInTheDocument();
  });

  it('appends the suffix (e.g. a percentage)', () => {
    render(<StatTile label="Would recommend" value={81} sampleSize={214} suffix="%" />);
    expect(screen.getByText('81.00%')).toBeInTheDocument();
  });

  it('singularizes "review" for a sample size of 1', () => {
    render(<StatTile label="x" value={4} sampleSize={1} />);
    expect(screen.getByText('1 review')).toBeInTheDocument();
  });

  // CLAUDE.md hard constraint #3 — a null score always means under the
  // n=3 shrinkage floor, never a hidden zero.
  it('never renders a number for a null (under-the-floor) score', () => {
    render(<StatTile label="Focus" value={null} sampleSize={2} />);
    expect(screen.getByText('Not enough reviews yet')).toBeInTheDocument();
    // Not /^\d/ — the sample-size text ("2 reviews") legitimately
    // starts with a digit; only a decimal-formatted score would be a
    // hidden-zero bug.
    expect(screen.queryByText(/^\d+\.\d+/)).not.toBeInTheDocument();
  });
});
