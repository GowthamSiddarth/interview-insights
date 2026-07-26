import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import WizardPage from '../src/app/search/page';

// The wizard now receives its company via query params instead of its own
// picker (a "Write a review" link from the search/landing page at /, or a
// company profile page) — a stable module-level instance so useSearchParams()
// returns the same reference across re-renders, matching real Next.js
// (a fresh object every render would re-trigger the auto-start effect).
const mockSearchParams = {
  current: new URLSearchParams('companyId=company-1&companySlug=acme-corp&companyName=Acme%20Corp'),
};
const mockRouterReplace = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: (...args: unknown[]) => mockRouterReplace(...args) }),
  useSearchParams: () => mockSearchParams.current,
}));

function mockFetch() {
  global.fetch = jest.fn().mockImplementation((input: RequestInfo | URL) => {
    const url = String(input);
    const respond = (body: unknown) =>
      Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
    if (url.endsWith('/round-types/field-options')) return respond({});
    if (url.endsWith('/companies') || url.includes('/processes/bulk')) {
      return respond({ id: 'company-new', name: 'New Co', slug: 'new-co', sizeBucket: 'mid' });
    }
    throw new Error(`Unmocked fetch: ${url}`);
  }) as jest.Mock;
}

function setLoggedInCookie(loggedIn: boolean) {
  document.cookie = loggedIn
    ? 'candidate_logged_in=1'
    : 'candidate_logged_in=; expires=Thu, 01 Jan 1970 00:00:00 UTC';
}

describe('WizardPage (the write-a-review flow, now at /search)', () => {
  beforeEach(() => {
    mockFetch();
    setLoggedInCookie(false);
    window.localStorage.clear();
    mockSearchParams.current = new URLSearchParams(
      'companyId=company-1&companySlug=acme-corp&companyName=Acme%20Corp',
    );
    mockRouterReplace.mockClear();
  });

  it('auto-starts a draft from the company carried in query params, and can go back to the drafts list', async () => {
    render(<WizardPage />);

    expect(await screen.findByRole('heading', { name: 'Acme Corp' })).toBeInTheDocument();
    // The query params are consumed once and stripped from the URL.
    expect(mockRouterReplace).toHaveBeenCalledWith('/search');

    await userEvent.setup().click(screen.getByRole('button', { name: 'Back to my drafts' }));

    expect(screen.queryByRole('heading', { name: 'Acme Corp' })).not.toBeInTheDocument();
    expect(await screen.findByText(/Acme Corp — Untitled process/)).toBeInTheDocument();
  });

  it('a draft survives being resumed after navigating back, with edited fields intact', async () => {
    const user = userEvent.setup();
    render(<WizardPage />);

    await screen.findByRole('heading', { name: 'Acme Corp' });
    await user.type(await screen.findByLabelText('Role title'), 'Senior Engineer');
    await user.click(screen.getByRole('button', { name: 'Back to my drafts' }));

    expect(await screen.findByText(/Acme Corp — Senior Engineer/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Resume' }));
    expect(await screen.findByDisplayValue('Senior Engineer')).toBeInTheDocument();
  });

  it('resumes the existing draft instead of creating a duplicate when re-arriving with the same company', async () => {
    const user = userEvent.setup();
    render(<WizardPage />);

    await screen.findByRole('heading', { name: 'Acme Corp' });
    await user.type(await screen.findByLabelText('Role title'), 'Senior Engineer');
    await user.click(screen.getByRole('button', { name: 'Back to my drafts' }));
    await screen.findByText(/Acme Corp — Senior Engineer/);

    // Simulate re-arriving via another "Write a review" click for the same
    // company (e.g. the candidate navigated away and came back) — this
    // must resume the existing draft, not silently create a second one.
    cleanup();
    mockSearchParams.current = new URLSearchParams(
      'companyId=company-1&companySlug=acme-corp&companyName=Acme%20Corp',
    );
    render(<WizardPage />);

    // Straight into the resumed draft, with the earlier edit intact.
    expect(await screen.findByDisplayValue('Senior Engineer')).toBeInTheDocument();

    // Back to the drafts list confirms there's still only the one entry —
    // no duplicate was silently created.
    await user.click(screen.getByRole('button', { name: 'Back to my drafts' }));
    expect(await screen.findAllByText(/Acme Corp — Senior Engineer/)).toHaveLength(1);
  });

  it('deletes a draft from the drafts list', async () => {
    window.confirm = jest.fn().mockReturnValue(true);
    const user = userEvent.setup();
    render(<WizardPage />);

    await screen.findByRole('heading', { name: 'Acme Corp' });
    await user.click(screen.getByRole('button', { name: 'Back to my drafts' }));
    expect(await screen.findByText(/Acme Corp — Untitled process/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    expect(screen.queryByText(/Acme Corp — Untitled process/)).not.toBeInTheDocument();
  });

  it('prompts to log in instead of showing the create-company form, when logged out and no company is selected', async () => {
    mockSearchParams.current = new URLSearchParams();
    render(<WizardPage />);

    expect(await screen.findByRole('link', { name: 'Log in to unlock' })).toHaveAttribute(
      'href',
      '/login',
    );
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
  });

  it('shows the create-company form when a candidate session exists, and starts a draft on creation', async () => {
    mockSearchParams.current = new URLSearchParams();
    setLoggedInCookie(true);
    render(<WizardPage />);

    expect(await screen.findByLabelText('Name')).toBeInTheDocument();
    expect(screen.getByLabelText('Slug')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Log in to unlock' })).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Name'), 'New Co');
    await user.type(screen.getByLabelText('Slug'), 'new-co');
    await user.click(screen.getByRole('button', { name: 'Create company' }));

    expect(await screen.findByRole('heading', { name: 'New Co' })).toBeInTheDocument();
  });

  it('links to the search/landing page to find a company, when none is selected', async () => {
    mockSearchParams.current = new URLSearchParams();
    render(<WizardPage />);

    const link = await screen.findByRole('link', { name: 'search page' });
    expect(link).toHaveAttribute('href', '/');
  });

  it('no longer offers a company-picker button grid (GitHub issue moving company selection upstream)', async () => {
    mockSearchParams.current = new URLSearchParams();
    render(<WizardPage />);

    await screen.findByText('Start a new draft');
    expect(screen.queryByRole('button', { name: 'Acme Corp' })).not.toBeInTheDocument();
  });

  it('shows the "Write a review" heading', async () => {
    mockSearchParams.current = new URLSearchParams();
    render(<WizardPage />);
    await waitFor(() => expect(screen.getByText('Write a review')).toBeInTheDocument());
  });
});
