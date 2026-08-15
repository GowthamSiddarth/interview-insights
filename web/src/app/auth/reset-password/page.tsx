'use client';

import { FormEvent, Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/Button';
import { PageContainer } from '@/components/PageContainer';

function errorMessage(err: unknown): string {
  if (err instanceof ApiError && err.status === 404) return 'This password reset link was not found.';
  if (err instanceof ApiError && err.status === 409) {
    return 'This password reset link has already been used. Request a new one below.';
  }
  if (err instanceof ApiError && err.status === 410) {
    return 'This password reset link has expired. Request a new one below.';
  }
  return err instanceof ApiError ? err.message : 'Something went wrong.';
}

// The landing route the reset email itself points to (its URL is built
// from CORS_ORIGIN — web's own origin — by
// CandidateAuthService.requestPasswordReset(), not a direct link to the
// api). Path must stay exactly /auth/reset-password to match. Unlike
// /auth/verify, this doesn't auto-consume the token on load — it needs
// the candidate to actually choose a new password first.
function ResetPasswordContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!token) return;
    setError(null);
    if (newPassword.length < 12) {
      setError('Password must be at least 12 characters.');
      return;
    }
    setSubmitting(true);
    try {
      await api.confirmPasswordReset(token, newPassword);
      // A hard navigation, not router.push — NavBar only checks its
      // session on mount, same reasoning as /auth/verify.
      window.location.href = '/';
    } catch (err) {
      setError(errorMessage(err));
      setSubmitting(false);
    }
  }

  return (
    <PageContainer>
      <header>
        <h1 className="text-2xl font-semibold">Choose a new password</h1>
      </header>

      {!token && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          No password reset token was provided.
        </p>
      )}

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      {token && (
        <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-3 sm:w-64">
          <label className="flex flex-col text-sm">
            New password
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="rounded-md border border-gray-300 px-2 py-1 transition-colors focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-900"
              autoComplete="new-password"
              minLength={12}
              required
            />
          </label>
          <p className="text-xs text-gray-500">At least 12 characters.</p>
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Saving…' : 'Save new password'}
          </Button>
        </form>
      )}

      {(error || !token) && (
        <Link
          href="/login/forgot-password"
          className="text-sm text-indigo-600 underline transition-colors hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
        >
          Request a new reset link
        </Link>
      )}
    </PageContainer>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordContent />
    </Suspense>
  );
}
