import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { GatedSection } from '../src/components/GatedSection';

describe('GatedSection', () => {
  it('renders nothing while the session-hint check is still pending', () => {
    const { container } = render(
      <GatedSection loggedIn={null} prompt="Log in to see more">
        <p>Secret content</p>
      </GatedSection>,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('shows the prompt and a login link when logged out, hiding the children', () => {
    render(
      <GatedSection loggedIn={false} prompt="Log in to see more">
        <p>Secret content</p>
      </GatedSection>,
    );

    expect(screen.getByText('Log in to see more')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Log in to unlock' })).toHaveAttribute('href', '/login');
    expect(screen.queryByText('Secret content')).not.toBeInTheDocument();
  });

  it('renders the children unchanged when logged in', () => {
    render(
      <GatedSection loggedIn={true} prompt="Log in to see more">
        <p>Secret content</p>
      </GatedSection>,
    );

    expect(screen.getByText('Secret content')).toBeInTheDocument();
    expect(screen.queryByText('Log in to see more')).not.toBeInTheDocument();
  });
});
