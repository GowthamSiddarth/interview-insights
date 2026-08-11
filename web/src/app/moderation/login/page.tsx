'use client';

import { FormEvent, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/Button';
import { PageContainer } from '@/components/PageContainer';

function errorMessage(err: unknown): string {
  if (err instanceof ApiError && err.status === 401) return 'Incorrect username or password.';
  if (err instanceof ApiError && err.status === 429) return 'Too many attempts. Try again later.';
  return err instanceof ApiError ? err.message : 'Something went wrong.';
}

export default function ModerationLoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.adminLogin(username, password);
      // GitHub issue #591 (Phase 42) — a hard navigation, not router.push():
      // NavBar/moderation page's own session-state UI only checks session
      // at mount, same reasoning as web/CLAUDE.md's rule for every other
      // session-changing action (login/logout/magic-link verify).
      window.location.href = '/moderation';
    } catch (err) {
      setError(errorMessage(err));
      setSubmitting(false);
    }
  }

  return (
    <PageContainer>
      <header>
        <h1 className="text-2xl font-semibold">Admin login</h1>
        <p className="text-sm text-gray-500">Staff login — admin, moderator, and staff accounts.</p>
      </header>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-3 sm:w-64">
        <label className="flex flex-col text-sm">
          Username
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="rounded-md border border-gray-300 px-2 py-1 transition-colors focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-900"
            autoComplete="username"
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
            autoComplete="current-password"
            required
          />
        </label>
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Logging in…' : 'Log in'}
        </Button>
      </form>
    </PageContainer>
  );
}
