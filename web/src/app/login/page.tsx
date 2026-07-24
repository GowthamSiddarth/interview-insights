'use client';

import { FormEvent, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/Button';
import { PageContainer } from '@/components/PageContainer';

function errorMessage(err: unknown): string {
  if (err instanceof ApiError && err.status === 429) return 'Too many attempts. Try again later.';
  return err instanceof ApiError ? err.message : 'Something went wrong.';
}

export default function LoginPage() {
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
        <h1 className="text-2xl font-semibold">Log in</h1>
        <p className="text-sm text-gray-500">
          No password — we&apos;ll email you a one-time link to log in.
        </p>
      </header>

      {error && (
        <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      {linkRequestedFor ? (
        <p className="text-sm text-green-700 dark:text-green-400">
          If an account exists for {linkRequestedFor}, a login link is on its way. Check your
          inbox — the link expires in 15 minutes and can only be used once.
        </p>
      ) : (
        <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-3 sm:w-64">
          <label className="flex flex-col text-sm">
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded border px-2 py-1 dark:bg-gray-900"
              autoComplete="email"
              required
            />
          </label>
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Sending…' : 'Send login link'}
          </Button>
        </form>
      )}
    </PageContainer>
  );
}
