'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/Button';
import { PageContainer } from '@/components/PageContainer';

function errorMessage(err: unknown): string {
  if (err instanceof ApiError && err.status === 401) return 'Incorrect username or password.';
  if (err instanceof ApiError && err.status === 429) return 'Too many attempts. Try again later.';
  return err instanceof ApiError ? err.message : 'Something went wrong.';
}

export default function ModerationLoginPage() {
  const router = useRouter();
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
      router.push('/moderation');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PageContainer>
      <header>
        <h1 className="text-2xl font-semibold">Admin login</h1>
        <p className="text-sm text-gray-500">Moderation queue access — single shared admin credential.</p>
      </header>

      {error && (
        <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-3 sm:w-64">
        <label className="flex flex-col text-sm">
          Username
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="rounded border px-2 py-1 dark:bg-gray-900"
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
            className="rounded border px-2 py-1 dark:bg-gray-900"
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
