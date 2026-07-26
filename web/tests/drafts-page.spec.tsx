import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import DraftsPage from '../src/app/drafts/page';
import { createDraft } from '../src/lib/draft-store';

const push = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

function setLoggedInCookie(loggedIn: boolean) {
  document.cookie = loggedIn
    ? 'candidate_logged_in=1'
    : 'candidate_logged_in=; expires=Thu, 01 Jan 1970 00:00:00 UTC';
}

describe('DraftsPage (GitHub issue #359, Phase 34)', () => {
  beforeEach(() => {
    push.mockClear();
    window.localStorage.clear();
  });

  it('prompts to log in instead of showing drafts, when logged out', async () => {
    setLoggedInCookie(false);
    createDraft({ id: 'company-1', name: 'Acme Corp', slug: 'acme-corp' });
    render(<DraftsPage />);

    expect(await screen.findByRole('link', { name: 'Log in to unlock' })).toHaveAttribute(
      'href',
      '/login',
    );
    expect(screen.queryByText(/Acme Corp/)).not.toBeInTheDocument();
  });

  it('shows an explicit empty state when logged in with no drafts', async () => {
    setLoggedInCookie(true);
    render(<DraftsPage />);

    expect(await screen.findByText('You have no drafts in progress.')).toBeInTheDocument();
  });

  it('lists every draft when logged in', async () => {
    setLoggedInCookie(true);
    createDraft({ id: 'company-1', name: 'Acme Corp', slug: 'acme-corp' });
    createDraft({ id: 'company-2', name: 'Globex', slug: 'globex' });
    render(<DraftsPage />);

    expect(await screen.findByText(/Acme Corp — Untitled process/)).toBeInTheDocument();
    expect(screen.getByText(/Globex — Untitled process/)).toBeInTheDocument();
  });

  it('resuming a draft navigates to /write-review with its draftId', async () => {
    setLoggedInCookie(true);
    const draft = createDraft({ id: 'company-1', name: 'Acme Corp', slug: 'acme-corp' });
    const user = userEvent.setup();
    render(<DraftsPage />);

    await user.click(await screen.findByRole('button', { name: 'Resume' }));

    expect(push).toHaveBeenCalledWith(`/write-review?draftId=${draft.id}`);
  });

  it('deletes a draft after confirming', async () => {
    setLoggedInCookie(true);
    window.confirm = jest.fn().mockReturnValue(true);
    createDraft({ id: 'company-1', name: 'Acme Corp', slug: 'acme-corp' });
    const user = userEvent.setup();
    render(<DraftsPage />);

    await user.click(await screen.findByRole('button', { name: 'Delete' }));

    expect(screen.queryByText(/Acme Corp/)).not.toBeInTheDocument();
    expect(await screen.findByText('You have no drafts in progress.')).toBeInTheDocument();
  });

  it('does not delete when the confirmation is declined', async () => {
    setLoggedInCookie(true);
    window.confirm = jest.fn().mockReturnValue(false);
    createDraft({ id: 'company-1', name: 'Acme Corp', slug: 'acme-corp' });
    const user = userEvent.setup();
    render(<DraftsPage />);

    await user.click(await screen.findByRole('button', { name: 'Delete' }));

    expect(screen.getByText(/Acme Corp/)).toBeInTheDocument();
  });
});
