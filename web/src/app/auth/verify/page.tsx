'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { PageContainer } from '@/components/PageContainer';

function errorMessage(err: unknown): string {
  if (err instanceof ApiError && err.status === 404) return 'This login link was not found.';
  if (err instanceof ApiError && err.status === 409) {
    return 'This login link has already been used. Request a new one below.';
  }
  if (err instanceof ApiError && err.status === 410) {
    return 'This login link has expired. Request a new one below.';
  }
  return err instanceof ApiError ? err.message : 'Something went wrong.';
}

// The landing route the magic-link email itself points to (its URL is
// built from CORS_ORIGIN — web's own origin — by
// CandidateAuthService.requestLink(), not a direct link to the api).
// Path must stay exactly /auth/verify to match.
function VerifyContent() {
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const token = searchParams.get('token');
    if (!token) {
      setError('No login token was provided.');
      setChecked(true);
      return;
    }
    api
      .verifyMagicLink(token)
      .then(() => {
        // A hard navigation, not router.push — NavBar (mounted once in the
        // root layout, persisting across client-side route changes) only
        // checks its session on mount. A client-side push here would leave
        // it stuck showing "Log in" even though the cookie was just set;
        // a full reload remounts it and picks up the new session honestly.
        window.location.href = '/';
      })
      .catch((err: unknown) => {
        setError(errorMessage(err));
        setChecked(true);
      });
  }, [searchParams]);

  return (
    <PageContainer>
      <header>
        <h1 className="text-2xl font-semibold">Logging you in…</h1>
      </header>
      {!checked && !error && <p className="text-sm text-gray-500">One moment…</p>}
      {error && (
        <div className="flex flex-col gap-2">
          <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {error}
          </p>
          <Link
            href="/login"
            className="text-indigo-600 underline hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
          >
            Request a new login link
          </Link>
        </div>
      )}
    </PageContainer>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={null}>
      <VerifyContent />
    </Suspense>
  );
}
