import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import HomePage from '../src/app/page';

function mockFetch(companies: unknown[]) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(companies),
  }) as jest.Mock;
}

function setLoggedInCookie(loggedIn: boolean) {
  document.cookie = loggedIn
    ? 'candidate_logged_in=1'
    : 'candidate_logged_in=; expires=Thu, 01 Jan 1970 00:00:00 UTC';
}

describe('HomePage', () => {
  beforeEach(() => {
    mockFetch([]);
    setLoggedInCookie(false);
  });

  it('renders the platform name and loads the (empty) company list', async () => {
    render(<HomePage />);
    expect(screen.getByText('Interview Insights')).toBeInTheDocument();

    await waitFor(() => expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/companies'),
      expect.anything(),
    ));
  });

  it('lets you change the selected company without a page reload', async () => {
    mockFetch([{ id: 'company-1', name: 'Acme Corp', slug: 'acme-corp', sizeBucket: 'mid' }]);

    const user = userEvent.setup();
    render(<HomePage />);

    await user.click(await screen.findByRole('button', { name: 'Acme Corp' }));
    expect(await screen.findByText(/Using Acme Corp/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Change company' }));

    expect(screen.queryByText(/Using Acme Corp/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Acme Corp' })).toBeInTheDocument();
  });

  it('prompts to log in instead of collecting an email, when there is no candidate session', async () => {
    mockFetch([{ id: 'company-1', name: 'Acme Corp', slug: 'acme-corp', sizeBucket: 'mid' }]);

    const user = userEvent.setup();
    render(<HomePage />);

    await user.click(await screen.findByRole('button', { name: 'Acme Corp' }));
    expect(await screen.findByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login');
    expect(screen.queryByLabelText('Role title')).not.toBeInTheDocument();
  });

  it('shows the process form directly (no email field) when a candidate session exists', async () => {
    setLoggedInCookie(true);
    mockFetch([{ id: 'company-1', name: 'Acme Corp', slug: 'acme-corp', sizeBucket: 'mid' }]);

    const user = userEvent.setup();
    render(<HomePage />);

    await user.click(await screen.findByRole('button', { name: 'Acme Corp' }));
    expect(await screen.findByLabelText('Role title')).toBeInTheDocument();
    expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument();
  });
});
