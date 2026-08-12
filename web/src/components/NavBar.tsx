'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Menu, X } from 'lucide-react';
import { api } from '@/lib/api';
import { BrandMark } from '@/components/BrandMark';
import { ThemeToggle } from '@/components/ThemeToggle';

const linkClass =
  'text-indigo-600 underline transition-colors hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300';

// Rendered once, in the root layout — present on every route. Each
// page keeps its own title/description (page-specific); only the
// genuinely shared navigation (home, search, session state) lives here.
export function NavBar() {
  const router = useRouter();
  // null = still checking (SSR/first paint, before the cookie hint is
  // readable); false = no session; true = logged in. Read from the
  // hasCandidateSessionHint() cookie, not a GET /auth/me network call —
  // NavBar renders on every page, for every anonymous visitor too, so a
  // network round trip here would 401 on the platform's single most
  // common page view (see api.ts's own comment).
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  // GitHub issue #616 — below the `sm` breakpoint the desktop row
  // (5 links + the theme toggle + a session control) has nowhere to
  // go; it wraps onto 2-3 lines with no visual structure. Collapses
  // into this panel instead. NavBar persists across client-side Link
  // navigation (it lives in the root layout, not remounted per page),
  // so every link/button inside the panel closes it on click —
  // otherwise it would stay open after navigating.
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setLoggedIn(api.hasCandidateSessionHint());
  }, []);

  async function logout(): Promise<void> {
    await api.candidateLogout().catch(() => undefined);
    setLoggedIn(false);
    setMobileOpen(false);
    router.push('/');
    router.refresh();
  }

  return (
    <nav className="border-b border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
      {/* max-w-4xl matches PageContainer's "wide" size (issue #231) —
          the widest a page ever gets — so the nav bar never looks
          narrower than the content below it. */}
      <div className="mx-auto flex max-w-4xl items-center gap-4 px-4 py-3 text-sm sm:px-8">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <BrandMark />
          Interview Insights
        </Link>

        {/* Desktop row — hidden below sm, replaced by the panel below. */}
        <div className="hidden items-center gap-4 sm:flex sm:flex-1">
          {/* No standalone "Write a review" nav link (GitHub issue #358) —
              writing a review is always company-specific now, reached via a
              "Write a review" link on search results or a company's profile
              page, never a bare entry point with no company context. */}
          {/* Internal/admin page — gated by its own login screen (Phase 18
              issue #160), not linked to here based on session state. */}
          <Link href="/moderation" className={linkClass}>
            Moderation
          </Link>
          {loggedIn === true && (
            <Link href="/me" className={linkClass}>
              My reviews
            </Link>
          )}
          {/* GitHub issue #359 (Phase 34) — drafts are gated behind login
              (same visibility rule as "My reviews"), even though the
              underlying storage is just localStorage, not a real session. */}
          {loggedIn === true && (
            <Link href="/drafts" className={linkClass}>
              My drafts
            </Link>
          )}
          <span className="ml-auto flex items-center gap-4">
            <ThemeToggle />
            {loggedIn === true && (
              <button type="button" onClick={() => void logout()} className={linkClass}>
                Log out
              </button>
            )}
            {loggedIn === false && (
              <Link href="/login" className={linkClass}>
                Log in
              </Link>
            )}
          </span>
        </div>

        <button
          type="button"
          onClick={() => setMobileOpen((open) => !open)}
          aria-expanded={mobileOpen}
          aria-controls="mobile-nav-panel"
          aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
          className="ml-auto rounded-md p-1.5 text-gray-500 transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:text-gray-400 dark:hover:bg-gray-800 sm:hidden"
        >
          {mobileOpen ? <X aria-hidden="true" className="h-5 w-5" /> : <Menu aria-hidden="true" className="h-5 w-5" />}
        </button>
      </div>

      {mobileOpen && (
        <div
          id="mobile-nav-panel"
          className="flex flex-col gap-3 border-t border-gray-200 px-4 py-3 text-sm dark:border-gray-700 sm:hidden"
        >
          <Link href="/moderation" className={linkClass} onClick={() => setMobileOpen(false)}>
            Moderation
          </Link>
          {loggedIn === true && (
            <Link href="/me" className={linkClass} onClick={() => setMobileOpen(false)}>
              My reviews
            </Link>
          )}
          {loggedIn === true && (
            <Link href="/drafts" className={linkClass} onClick={() => setMobileOpen(false)}>
              My drafts
            </Link>
          )}
          {loggedIn === true && (
            <button type="button" onClick={() => void logout()} className={`${linkClass} self-start`}>
              Log out
            </button>
          )}
          {loggedIn === false && (
            <Link href="/login" className={linkClass} onClick={() => setMobileOpen(false)}>
              Log in
            </Link>
          )}
          <div className="border-t border-gray-200 pt-3 dark:border-gray-700">
            <ThemeToggle />
          </div>
        </div>
      )}
    </nav>
  );
}
