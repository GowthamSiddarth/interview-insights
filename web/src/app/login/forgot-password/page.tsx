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

// GitHub issue #683 (Phase 48, D104) — forgot-password flow, first half.
// Same honest-status discipline as /login/magic-link: the API never
// throws on an unknown email (D30-style enumeration safety), so this
// confirmation is deliberately identical either way.
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resetRequestedFor, setResetRequestedFor] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.requestPasswordReset(email);
      setResetRequestedFor(email);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PageContainer>
      <header>
        <h1 className="text-2xl font-semibold">Reset your password</h1>
        <p className="text-sm text-gray-500">
          Enter your email and we&apos;ll send you a link to choose a new password.
        </p>
      </header>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      {resetRequestedFor ? (
        <p className="text-sm text-green-700 dark:text-green-400">
          If an account exists for {resetRequestedFor}, a password reset link is on its way. Check
          your inbox — the link expires in 15 minutes and can only be used once.
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
            {submitting ? 'Sending…' : 'Send reset link'}
          </Button>
        </form>
      )}

      <Link
        href="/login"
        className="text-sm text-indigo-600 underline transition-colors hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
      >
        Back to log in
      </Link>
    </PageContainer>
  );
}
