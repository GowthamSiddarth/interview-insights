import { render, screen, waitFor } from '@testing-library/react';
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
});
