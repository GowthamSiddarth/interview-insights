import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import HomePage from '../src/app/page';

describe('HomePage', () => {
  it('renders the platform name', () => {
    render(<HomePage />);
    expect(screen.getByText('Interview Insights')).toBeInTheDocument();
  });
});
