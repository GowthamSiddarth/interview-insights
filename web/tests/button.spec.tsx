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

  // GitHub issue #618 — href renders a real <Link> (role="link"), not a
  // <button>, so navigation CTAs keep right-click/open-in-new-tab/
  // status-bar-preview instead of losing them to an onClick handler.
  describe('with href', () => {
    it('renders a link, not a button, carrying the same default styling', () => {
      render(<Button href="/write-review">Write a review</Button>);
      const link = screen.getByRole('link', { name: 'Write a review' });
      expect(link).toHaveAttribute('href', '/write-review');
      expect(link.className).toContain('bg-indigo-600');
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });

    it('still applies the requested variant', () => {
      render(
        <Button href="/moderation" variant="danger">
          Danger link
        </Button>,
      );
      expect(screen.getByRole('link', { name: 'Danger link' }).className).toContain('bg-red-600');
    });
  });
});
