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
    window.localStorage.clear();
  });

  it('renders the platform name and loads the (empty) company list', async () => {
    render(<HomePage />);
    expect(screen.getByText('Interview Insights')).toBeInTheDocument();

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/companies'),
        expect.anything(),
      ),
    );
  });

  it('starts a draft when picking an existing company, and can go back to the drafts list', async () => {
    mockFetch([{ id: 'company-1', name: 'Acme Corp', slug: 'acme-corp', sizeBucket: 'mid' }]);

    const user = userEvent.setup();
    render(<HomePage />);

    await user.click(await screen.findByRole('button', { name: 'Acme Corp' }));
    expect(await screen.findByRole('heading', { name: 'Acme Corp' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Back to my drafts' }));

    expect(screen.queryByRole('heading', { name: 'Acme Corp' })).not.toBeInTheDocument();
    expect(await screen.findByText(/Acme Corp — Untitled process/)).toBeInTheDocument();
  });

  it('a draft survives being resumed after navigating back, with edited fields intact', async () => {
    mockFetch([{ id: 'company-1', name: 'Acme Corp', slug: 'acme-corp', sizeBucket: 'mid' }]);

    const user = userEvent.setup();
    render(<HomePage />);

    await user.click(await screen.findByRole('button', { name: 'Acme Corp' }));
    await user.type(await screen.findByLabelText('Role title'), 'Senior Engineer');
    await user.click(screen.getByRole('button', { name: 'Back to my drafts' }));

    expect(await screen.findByText(/Acme Corp — Senior Engineer/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Resume' }));
    expect(await screen.findByDisplayValue('Senior Engineer')).toBeInTheDocument();
  });

  it('deletes a draft from the drafts list', async () => {
    mockFetch([{ id: 'company-1', name: 'Acme Corp', slug: 'acme-corp', sizeBucket: 'mid' }]);
    window.confirm = jest.fn().mockReturnValue(true);

    const user = userEvent.setup();
    render(<HomePage />);

    await user.click(await screen.findByRole('button', { name: 'Acme Corp' }));
    await user.click(screen.getByRole('button', { name: 'Back to my drafts' }));
    expect(await screen.findByText(/Acme Corp — Untitled process/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(screen.queryByText(/Acme Corp — Untitled process/)).not.toBeInTheDocument();
  });

  it('prompts to log in instead of showing the create-company form, when logged out', async () => {
    render(<HomePage />);

    expect(await screen.findByRole('link', { name: 'Log in to unlock' })).toHaveAttribute(
      'href',
      '/login',
    );
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
  });

  it('shows the create-company form when a candidate session exists, and starts a draft on creation', async () => {
    setLoggedInCookie(true);
    render(<HomePage />);

    expect(await screen.findByLabelText('Name')).toBeInTheDocument();
    expect(screen.getByLabelText('Slug')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Log in to unlock' })).not.toBeInTheDocument();

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({ id: 'company-new', name: 'New Co', slug: 'new-co', sizeBucket: 'mid' }),
    }) as jest.Mock;

    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Name'), 'New Co');
    await user.type(screen.getByLabelText('Slug'), 'new-co');
    await user.click(screen.getByRole('button', { name: 'Create company' }));

    expect(await screen.findByRole('heading', { name: 'New Co' })).toBeInTheDocument();
  });
});
