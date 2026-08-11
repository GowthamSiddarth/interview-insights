'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/Button';
import { PageContainer } from '@/components/PageContainer';

function errorMessage(err: unknown): string {
  if (err instanceof ApiError && err.status === 401 && err.message.includes('Current password')) {
    return err.message;
  }
  if (err instanceof ApiError && err.status === 401) return 'Session expired — log in again.';
  return err instanceof ApiError ? err.message : 'Something went wrong.';
}

// GitHub issue #589/#591 (Phase 42, D99) — self-service password change,
// available to every role (no permission gate on the backend: it only
// ever acts on the caller's own session).
export default function ChangePasswordPage() {
  const router = useRouter();
  const [sessionChecked, setSessionChecked] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api
      .getAdminSession()
      .then(() => setSessionChecked(true))
      .catch(() => router.push('/moderation/login'));
  }, [router]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }
    setSubmitting(true);
    try {
      await api.changeAdminPassword(currentPassword, newPassword);
      setSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401 && !err.message.includes('Current password')) {
        router.push('/moderation/login');
        return;
      }
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (!sessionChecked) return null;

  return (
    <PageContainer>
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Change password</h1>
          <p className="text-sm text-gray-500">Applies to your own account only.</p>
        </div>
        <Link href="/moderation" className="text-sm text-indigo-600 underline dark:text-indigo-400">
          Back to moderation queue
        </Link>
      </header>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}
      {success && (
        <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-950 dark:text-green-300">
          Password changed.
        </p>
      )}

      <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-3 sm:w-64">
        <label className="flex flex-col text-sm">
          Current password
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className="rounded-md border border-gray-300 px-2 py-1 transition-colors focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-900"
            autoComplete="current-password"
            required
          />
        </label>
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
        <label className="flex flex-col text-sm">
          Confirm new password
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="rounded-md border border-gray-300 px-2 py-1 transition-colors focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-900"
            autoComplete="new-password"
            minLength={12}
            required
          />
        </label>
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Saving…' : 'Change password'}
        </Button>
      </form>
    </PageContainer>
  );
}
