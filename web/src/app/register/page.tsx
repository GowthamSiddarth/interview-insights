'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/Button';
import { PageContainer } from '@/components/PageContainer';

function errorMessage(err: unknown): string {
  if (err instanceof ApiError && err.status === 409) {
    return 'An account with this email already has a password set. Try logging in, or use "Forgot your password?" instead.';
  }
  return err instanceof ApiError ? err.message : 'Something went wrong.';
}

// GitHub issue #683 (Phase 48, D104) — password registration. Auto-logs
// in on success (same as the API itself does — see
// CandidateAuthController.register()'s own comment), so this hard-
// navigates home exactly like /login does.
export default function RegisterPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (password.length < 12) {
      setError('Password must be at least 12 characters.');
      return;
    }
    setSubmitting(true);
    try {
      await api.registerCandidate(email, password);
      window.location.href = '/';
    } catch (err) {
      setError(errorMessage(err));
      setSubmitting(false);
    }
  }

  return (
    <PageContainer>
      <header>
        <h1 className="text-2xl font-semibold">Create an account</h1>
      </header>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

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
        <label className="flex flex-col text-sm">
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-md border border-gray-300 px-2 py-1 transition-colors focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-900"
            autoComplete="new-password"
            minLength={12}
            required
          />
        </label>
        <p className="text-xs text-gray-500">At least 12 characters.</p>
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Creating account…' : 'Create account'}
        </Button>
      </form>

      <Link
        href="/login"
        className="text-sm text-indigo-600 underline transition-colors hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
      >
        Already have an account? Log in
      </Link>
    </PageContainer>
  );
}
