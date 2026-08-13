import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ScoreRing } from '../src/components/ScoreRing';

describe('ScoreRing', () => {
  it('renders the value, label, and sample size', () => {
    render(<ScoreRing label="Overall experience" value={4.2} sampleSize={214} />);
    expect(screen.getByText('4.2')).toBeInTheDocument();
    expect(screen.getByText('Overall experience')).toBeInTheDocument();
    expect(screen.getByText('214 reviews')).toBeInTheDocument();
  });

  it('singularizes "review" for a sample size of 1', () => {
    render(<ScoreRing label="Overall experience" value={5} sampleSize={1} />);
    expect(screen.getByText('1 review')).toBeInTheDocument();
  });

  // CLAUDE.md hard constraint #3 / docs/DATA_MODEL.md — a null score
  // always means under the n=3 shrinkage floor, never a hidden zero.
  it('never renders a number for a null (under-the-floor) score', () => {
    render(<ScoreRing label="Recruiter approachability" value={null} sampleSize={2} />);
    expect(screen.getByText('Not enough reviews yet')).toBeInTheDocument();
    expect(screen.queryByText(/^\d/)).not.toBeInTheDocument();
  });

  it('draws no filled ring segment for a null score, only the track', () => {
    const { container } = render(<ScoreRing label="x" value={null} sampleSize={0} />);
    // track + fill would be 2 circles when there's a value; null means
    // only the track circle.
    expect(container.querySelectorAll('circle')).toHaveLength(1);
  });

  it('draws a filled ring segment proportional to value/max', () => {
    const { container } = render(<ScoreRing label="x" value={4} sampleSize={10} max={5} />);
    const circles = container.querySelectorAll('circle');
    expect(circles).toHaveLength(2);
    const fill = circles[1];
    const circumference = 2 * Math.PI * 26;
    const expectedOffset = circumference * (1 - 4 / 5);
    expect(Number(fill.getAttribute('stroke-dashoffset'))).toBeCloseTo(expectedOffset, 1);
  });

  it('supports a non-5 max (e.g. a percentage score)', () => {
    render(<ScoreRing label="Would recommend" value={81} sampleSize={214} max={100} suffix="%" />);
    expect(screen.getByText('81.0%')).toBeInTheDocument();
  });
});
