'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/Button';
import { PageContainer } from '@/components/PageContainer';

function errorMessage(err: unknown): string {
  if (err instanceof ApiError && err.status === 429) return 'Too many attempts. Try again later.';
  return err instanceof ApiError ? err.message : 'Something went wrong.';
}

// GitHub issue #683 (Phase 48, D104) — moved here from /login, which is
// now the password-first primary flow. Same behavior as before, just a
// secondary entry point now, linked from /login rather than being it.
export default function MagicLinkLoginPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Set once the request succeeds — the API always returns the same
  // { status: 'ok' } shape whether or not the email is known (D30), so
  // this confirmation is deliberately identical either way. Same honest-
  // status discipline as the wizard's "yours is pending" messaging: it
  // says exactly what happened (a link was requested), not more.
  const [linkRequestedFor, setLinkRequestedFor] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.requestMagicLink(email);
      setLinkRequestedFor(email);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PageContainer>
      <header>
        <h1 className="text-2xl font-semibold">Log in with a one-time link</h1>
        <p className="text-sm text-gray-500">
          No password — enter your email and we&apos;ll send a one-time link. New here? The same
          link creates your account automatically.
        </p>
      </header>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      {linkRequestedFor ? (
        <p className="text-sm text-green-700 dark:text-green-400">
          A login link is on its way to {linkRequestedFor} — first time here? It creates your
          account too. Check your inbox — the link expires in 15 minutes and can only be used
          once.
        </p>
      ) : (
        <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-3 sm:w-64">
          <label className="flex flex-col text-sm">
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-md border border-gray-300 px-2 py-1 transition-colors focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-900"
              autoComplete="email"
              required
            />
          </label>
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Sending…' : 'Send login link'}
          </Button>
        </form>
      )}

      <Link
        href="/login"
        className="text-sm text-indigo-600 underline transition-colors hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
      >
        Back to password login
      </Link>
    </PageContainer>
  );
}
