import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ScoreDisplay } from '../src/components/ScoreDisplay';

describe('ScoreDisplay', () => {
  it('renders "Not enough reviews yet" when the score is null, never 0 or blank', () => {
    render(<ScoreDisplay label="Difficulty" value={null} sampleSize={2} />);

    expect(screen.getByText('Not enough reviews yet')).toBeInTheDocument();
    expect(screen.queryByText('0.00')).not.toBeInTheDocument();
    expect(screen.getByText('2 reviews')).toBeInTheDocument();
  });

  it('renders the formatted score and sample size when a score exists', () => {
    render(<ScoreDisplay label="Difficulty" value={3.5} sampleSize={12} />);

    expect(screen.getByText('3.50')).toBeInTheDocument();
    expect(screen.getByText('12 reviews')).toBeInTheDocument();
    expect(screen.queryByText('Not enough reviews yet')).not.toBeInTheDocument();
  });

  it('renders a suffix and singular "review" for a sample size of 1', () => {
    render(<ScoreDisplay label="Would recommend" value={80} sampleSize={1} suffix="%" />);

    expect(screen.getByText('80.00%')).toBeInTheDocument();
    expect(screen.getByText('1 review')).toBeInTheDocument();
  });
});
