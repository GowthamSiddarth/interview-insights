import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { NavBar } from '../src/components/NavBar';

describe('NavBar', () => {
  it('links back to the homepage', () => {
    render(<NavBar />);
    expect(screen.getByRole('link', { name: 'Interview Insights' })).toHaveAttribute('href', '/');
  });

  it('links to the search page', () => {
    render(<NavBar />);
    expect(screen.getByRole('link', { name: /search companies/i })).toHaveAttribute(
      'href',
      '/search',
    );
  });
});
