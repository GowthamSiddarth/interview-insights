'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

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

  useEffect(() => {
    setLoggedIn(api.hasCandidateSessionHint());
  }, []);

  async function logout(): Promise<void> {
    await api.candidateLogout().catch(() => undefined);
    setLoggedIn(false);
    router.push('/');
    router.refresh();
  }

  return (
    <nav className="border-b border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
      <div className="mx-auto flex max-w-4xl items-center gap-4 px-8 py-3 text-sm">
        {/* max-w-4xl matches PageContainer's "wide" size (issue #231) —
            the widest a page ever gets — so the nav bar never looks
            narrower than the content below it. */}
        <Link href="/" className="font-semibold">
          Interview Insights
        </Link>
        <Link href="/search" className={linkClass}>
          Search companies &amp; reviews
        </Link>
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
        <span className="ml-auto">
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
    </nav>
  );
}
