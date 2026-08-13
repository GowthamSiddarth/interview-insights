import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { NavBar } from '../src/components/NavBar';

const push = jest.fn();
const refresh = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh }),
}));

function setLoggedInCookie(loggedIn: boolean) {
  document.cookie = loggedIn
    ? 'candidate_logged_in=1'
    : 'candidate_logged_in=; expires=Thu, 01 Jan 1970 00:00:00 UTC';
}

describe('NavBar', () => {
  afterEach(() => {
    setLoggedInCookie(false);
  });

  it('links back to the homepage', async () => {
    setLoggedInCookie(false);
    render(<NavBar />);
    expect(screen.getByRole('link', { name: 'Interview Insights' })).toHaveAttribute('href', '/');
    await screen.findByRole('link', { name: 'Log in' });
  });

  // GitHub issue #358 (Phase 34) — there is deliberately no standalone
  // "Write a review"/search nav link anymore: writing a review is always
  // company-specific (a link on search results or a company profile
  // page), and search/browse is what the Home link itself leads to now.
  it('has no standalone "Write a review" link', async () => {
    setLoggedInCookie(false);
    render(<NavBar />);
    await screen.findByRole('link', { name: 'Log in' });
    expect(screen.queryByRole('link', { name: /write a review/i })).not.toBeInTheDocument();
  });

  it('shows a login link when there is no candidate session', async () => {
    setLoggedInCookie(false);
    render(<NavBar />);
    expect(await screen.findByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login');
  });

  it('shows a log out control when a candidate session exists', async () => {
    setLoggedInCookie(true);
    render(<NavBar />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Log out' })).toBeInTheDocument());
  });

  it('hides the "My reviews" link when there is no candidate session', async () => {
    setLoggedInCookie(false);
    render(<NavBar />);
    await screen.findByRole('link', { name: 'Log in' });
    expect(screen.queryByRole('link', { name: 'My reviews' })).not.toBeInTheDocument();
  });

  it('shows a "My reviews" link when a candidate session exists', async () => {
    setLoggedInCookie(true);
    render(<NavBar />);
    expect(await screen.findByRole('link', { name: 'My reviews' })).toHaveAttribute('href', '/me');
  });

  // GitHub issue #359 (Phase 34) — "My drafts" follows the same
  // login-gated visibility rule as "My reviews".
  it('hides the "My drafts" link when there is no candidate session', async () => {
    setLoggedInCookie(false);
    render(<NavBar />);
    await screen.findByRole('link', { name: 'Log in' });
    expect(screen.queryByRole('link', { name: 'My drafts' })).not.toBeInTheDocument();
  });

  it('shows a "My drafts" link when a candidate session exists', async () => {
    setLoggedInCookie(true);
    render(<NavBar />);
    expect(await screen.findByRole('link', { name: 'My drafts' })).toHaveAttribute('href', '/drafts');
  });

  // GitHub issue #616 — below `sm`, the desktop row collapses into a
  // panel toggled by a hamburger button; the desktop row's own copy of
  // every link stays in the DOM throughout (CSS-hidden via `hidden
  // sm:flex`, not unmounted), so these assert against the *panel*
  // specifically via its container id, not just "a link named X exists
  // somewhere" (which the desktop row alone would already satisfy).
  describe('mobile menu', () => {
    it('is closed by default', async () => {
      setLoggedInCookie(false);
      render(<NavBar />);
      await screen.findByRole('link', { name: 'Log in' });
      expect(document.getElementById('mobile-nav-panel')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Open menu' })).toHaveAttribute('aria-expanded', 'false');
    });

    it('opens on hamburger click and closes again on a second click', async () => {
      const user = userEvent.setup();
      setLoggedInCookie(false);
      render(<NavBar />);
      await screen.findByRole('link', { name: 'Log in' });

      await user.click(screen.getByRole('button', { name: 'Open menu' }));
      expect(document.getElementById('mobile-nav-panel')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Close menu' })).toHaveAttribute('aria-expanded', 'true');

      await user.click(screen.getByRole('button', { name: 'Close menu' }));
      expect(document.getElementById('mobile-nav-panel')).not.toBeInTheDocument();
    });

    it('closes itself when a link inside it is clicked, not left open across navigation', async () => {
      const user = userEvent.setup();
      setLoggedInCookie(true);
      render(<NavBar />);
      await screen.findByRole('link', { name: 'My reviews' });

      await user.click(screen.getByRole('button', { name: 'Open menu' }));
      const panel = document.getElementById('mobile-nav-panel') as HTMLElement;
      const panelMyReviewsLink = within(panel).getByRole('link', { name: 'My reviews' });

      await user.click(panelMyReviewsLink);
      expect(document.getElementById('mobile-nav-panel')).not.toBeInTheDocument();
    });

    it('includes the theme toggle', async () => {
      const user = userEvent.setup();
      setLoggedInCookie(false);
      render(<NavBar />);
      await screen.findByRole('link', { name: 'Log in' });

      await user.click(screen.getByRole('button', { name: 'Open menu' }));
      const panel = document.getElementById('mobile-nav-panel') as HTMLElement;
      expect(within(panel).getByRole('group', { name: 'Theme' })).toBeInTheDocument();
    });
  });
});
