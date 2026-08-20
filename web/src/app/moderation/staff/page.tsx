'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, ApiError, StaffAccount, StaffRole } from '@/lib/api';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { PageContainer } from '@/components/PageContainer';
import { StatusPill } from '@/components/StatusPill';

const STAFF_ROLES: StaffRole[] = ['staff', 'moderator', 'admin'];

const inputClass =
  'rounded-md border border-gray-300 px-2 py-1 text-sm transition-colors focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-900';

function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Something went wrong.';
}

// A 401 anywhere on this page always means the session expired mid-use —
// same shape as web/src/app/moderation/page.tsx's isSessionExpired().
function isSessionExpired(err: unknown): boolean {
  return err instanceof ApiError && err.status === 401;
}

// GitHub issue #591 (Phase 42, D99) — shown once, immediately after a
// create or reset-password call, never persisted anywhere client-side
// beyond this component's own state. Same one-time-reveal UX
// infra/scripts/rotate-admin-credentials.sh already established.
function OneTimePassword({ username, password, onDismiss }: { username: string; password: string; onDismiss: () => void }) {
  return (
    <Card className="flex flex-col gap-2 border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950">
      <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
        Password for <span className="font-mono">{username}</span> — save this now, it will not be
        shown again:
      </p>
      <code className="rounded-md bg-white px-2 py-1 text-sm dark:bg-gray-900">{password}</code>
      <div>
        <Button type="button" variant="neutral" onClick={onDismiss}>
          I&apos;ve saved it
        </Button>
      </div>
    </Card>
  );
}

interface StaffAccountRowProps {
  account: StaffAccount;
  onChanged: () => void;
  setError: (msg: string | null) => void;
  onSessionExpired: () => void;
  onOneTimePassword: (username: string, password: string) => void;
}

function StaffAccountRow({ account, onChanged, setError, onSessionExpired, onOneTimePassword }: StaffAccountRowProps) {
  const [role, setRole] = useState<StaffRole>(account.role);

  async function handleSaveRole() {
    if (role === account.role) return;
    setError(null);
    try {
      await api.updateStaffRole(account.id, role);
      onChanged();
    } catch (err) {
      if (isSessionExpired(err)) onSessionExpired();
      else setError(errorMessage(err));
    }
  }

  async function handleToggleActive() {
    setError(null);
    try {
      if (account.isActive) await api.deactivateStaffAccount(account.id);
      else await api.reactivateStaffAccount(account.id);
      onChanged();
    } catch (err) {
      if (isSessionExpired(err)) onSessionExpired();
      else setError(errorMessage(err));
    }
  }

  async function handleResetPassword() {
    setError(null);
    try {
      const { password } = await api.resetStaffPassword(account.id);
      onOneTimePassword(account.username, password);
    } catch (err) {
      if (isSessionExpired(err)) onSessionExpired();
      else setError(errorMessage(err));
    }
  }

  return (
    <div
      className={`flex flex-wrap items-center gap-2 rounded-md border p-2 text-sm ${
        account.isActive ? 'border-gray-100 dark:border-gray-800' : 'border-gray-100 opacity-60 dark:border-gray-800'
      }`}
    >
      <span className="font-mono font-medium">{account.username}</span>
      <span className="text-gray-500">{account.email}</span>
      <label className="ml-auto flex items-center gap-1 text-xs text-gray-500">
        role
        <select
          aria-label={`Role for ${account.username}`}
          value={role}
          onChange={(e) => setRole(e.target.value as StaffRole)}
          className={inputClass}
        >
          {STAFF_ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>
      <Button type="button" onClick={() => void handleSaveRole()} disabled={role === account.role}>
        Save role
      </Button>
      <Button type="button" variant={account.isActive ? 'danger' : 'neutral'} onClick={() => void handleToggleActive()}>
        {account.isActive ? 'Deactivate' : 'Reactivate'}
      </Button>
      <Button type="button" variant="warning" onClick={() => void handleResetPassword()}>
        Reset password
      </Button>
      {/* GitHub issue #620 — both states get the same pill treatment now,
          not just the negative one (the old version only ever rendered
          a plain "deactivated" label, nothing for the active case). */}
      <StatusPill tone={account.isActive ? 'good' : 'critical'}>
        {account.isActive ? 'Active' : 'Deactivated'}
      </StatusPill>
    </div>
  );
}

export default function StaffAccountsPage() {
  const router = useRouter();
  const [sessionChecked, setSessionChecked] = useState(false);
  const [accounts, setAccounts] = useState<StaffAccount[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [oneTimePassword, setOneTimePassword] = useState<{ username: string; password: string } | null>(null);

  const [newUsername, setNewUsername] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState<StaffRole>('staff');
  const [creating, setCreating] = useState(false);

  // admin:staff:manage is admin-tier only (D99) — the backend already
  // 403s a moderator/staff session on every route here, this just avoids
  // rendering a form whose every submit would fail.
  useEffect(() => {
    api
      .getAdminSession()
      .then((session) => {
        if (session.role !== 'admin') {
          router.push('/moderation');
          return;
        }
        setSessionChecked(true);
      })
      .catch(() => router.push('/moderation/login'));
  }, [router]);

  function loadAccounts() {
    api
      .listStaffAccounts()
      .then(setAccounts)
      .catch((err: unknown) => {
        if (isSessionExpired(err)) router.push('/moderation/login');
        else setError(errorMessage(err));
      });
  }

  useEffect(() => {
    if (!sessionChecked) return;
    loadAccounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadAccounts is stable enough for this effect's purpose
  }, [sessionChecked]);

  async function handleCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setCreating(true);
    try {
      const created = await api.createStaffAccount({ username: newUsername, email: newEmail, role: newRole });
      setOneTimePassword({ username: created.username, password: created.password });
      setNewUsername('');
      setNewEmail('');
      setNewRole('staff');
      loadAccounts();
    } catch (err) {
      if (isSessionExpired(err)) router.push('/moderation/login');
      else setError(errorMessage(err));
    } finally {
      setCreating(false);
    }
  }

  if (!sessionChecked) return null;

  return (
    <PageContainer size="wide">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Staff accounts</h1>
          <p className="text-sm text-gray-500">
            Create and manage admin/moderator/staff accounts. Deactivating blocks login
            without deleting the account or its history.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 text-sm">
          <Link href="/moderation/staff/audit-log" className="text-indigo-600 underline dark:text-indigo-400">
            View audit log
          </Link>
          <Link href="/moderation" className="text-indigo-600 underline dark:text-indigo-400">
            Back to moderation queue
          </Link>
        </div>
      </header>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      {oneTimePassword && (
        <OneTimePassword
          username={oneTimePassword.username}
          password={oneTimePassword.password}
          onDismiss={() => setOneTimePassword(null)}
        />
      )}

      <Card as="section" className="flex flex-col gap-3">
        <h2 className="font-medium">Add a new account</h2>
        <form onSubmit={(e) => void handleCreate(e)} className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col text-sm">
            Username
            <input
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              className={inputClass}
              autoComplete="off"
              required
            />
          </label>
          <label className="flex flex-col text-sm">
            Email
            <input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              className={inputClass}
              autoComplete="off"
              required
            />
          </label>
          <label className="flex flex-col text-sm">
            Role
            <select value={newRole} onChange={(e) => setNewRole(e.target.value as StaffRole)} className={inputClass}>
              {STAFF_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" disabled={creating}>
            {creating ? 'Creating…' : 'Create account'}
          </Button>
        </form>
      </Card>

      <Card as="section" className="flex flex-col gap-2">
        <h2 className="font-medium">Existing accounts</h2>
        {accounts === null && <p className="text-sm text-gray-500">Loading…</p>}
        {accounts !== null && accounts.length === 0 && <EmptyState message="No staff accounts yet." />}
        {accounts?.map((account) => (
          <StaffAccountRow
            key={account.id}
            account={account}
            onChanged={loadAccounts}
            setError={setError}
            onSessionExpired={() => router.push('/moderation/login')}
            onOneTimePassword={(username, password) => setOneTimePassword({ username, password })}
          />
        ))}
      </Card>
    </PageContainer>
  );
}
