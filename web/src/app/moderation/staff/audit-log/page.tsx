'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api, ApiError, StaffAuditLogEntry } from '@/lib/api';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { PageContainer } from '@/components/PageContainer';

function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Something went wrong.';
}

// Same shape as web/src/app/moderation/page.tsx's isSessionExpired().
function isSessionExpired(err: unknown): boolean {
  return err instanceof ApiError && err.status === 401;
}

const ACTION_LABELS: Record<string, string> = {
  account_created: 'Account created',
  role_changed: 'Role changed',
  deactivated: 'Deactivated',
  reactivated: 'Reactivated',
  password_reset: 'Password reset',
};

function formatDetail(detail: unknown): string | null {
  if (detail === null || detail === undefined) return null;
  if (typeof detail === 'object') {
    return Object.entries(detail as Record<string, unknown>)
      .map(([key, value]) => `${key}: ${String(value)}`)
      .join(', ');
  }
  return String(detail);
}

// GitHub issue #799 (Phase 54) — the read side of every staff mutation
// StaffAuditLogService.record() already durably logs (account created,
// role changed, deactivated/reactivated, password reset). Same
// admin:staff:manage gate as web/src/app/moderation/staff/page.tsx —
// this page reuses that page's own session-check shape rather than a
// shared hook, since it's the only other page with this exact gate.
export default function StaffAuditLogPage() {
  const router = useRouter();
  const [sessionChecked, setSessionChecked] = useState(false);
  const [entries, setEntries] = useState<StaffAuditLogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => {
    if (!sessionChecked) return;
    api
      .listStaffAuditLog()
      .then(setEntries)
      .catch((err: unknown) => {
        if (isSessionExpired(err)) router.push('/moderation/login');
        else setError(errorMessage(err));
      });
  }, [sessionChecked, router]);

  if (!sessionChecked) return null;

  return (
    <PageContainer size="wide">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Staff audit log</h1>
          <p className="text-sm text-gray-500">
            Every staff account mutation — account created, role changed, deactivated/reactivated,
            password reset — most recent first.
          </p>
        </div>
        <Link href="/moderation/staff" className="text-sm text-indigo-600 underline dark:text-indigo-400">
          Back to staff accounts
        </Link>
      </header>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      <Card as="section" className="flex flex-col gap-2">
        {entries === null && <p className="text-sm text-gray-500">Loading…</p>}
        {entries !== null && entries.length === 0 && <EmptyState message="No audit log entries yet." />}
        {entries?.map((entry) => {
          const detail = formatDetail(entry.detail);
          return (
            <div
              key={entry.id}
              className="flex flex-col gap-1 border-b border-gray-100 py-2 text-sm last:border-0 dark:border-gray-800"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{ACTION_LABELS[entry.action] ?? entry.action}</span>
                <span className="text-xs text-gray-500">{new Date(entry.createdAt).toLocaleString()}</span>
              </div>
              <p className="text-gray-600 dark:text-gray-400">
                <span className="font-mono">{entry.actorUsername}</span> acted on{' '}
                <span className="font-mono">{entry.targetUsername}</span>
                {detail ? ` — ${detail}` : ''}
              </p>
            </div>
          );
        })}
      </Card>
    </PageContainer>
  );
}
