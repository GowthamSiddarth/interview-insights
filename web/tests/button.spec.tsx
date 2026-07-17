import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { Button } from '../src/components/Button';

describe('Button', () => {
  it('renders its children and forwards props', () => {
    render(<Button type="submit">Submit rating</Button>);
    const button = screen.getByRole('button', { name: 'Submit rating' });
    expect(button).toHaveAttribute('type', 'submit');
  });

  it('merges a caller-provided className with the default styling', () => {
    render(<Button className="col-span-full">Wide button</Button>);
    const button = screen.getByRole('button', { name: 'Wide button' });
    expect(button.className).toContain('col-span-full');
    expect(button.className).toContain('bg-indigo-600');
  });
});
