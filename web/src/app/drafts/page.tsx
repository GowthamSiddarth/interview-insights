'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { deleteDraft, listDrafts, ProcessDraft } from '@/lib/draft-store';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { GatedSection } from '@/components/GatedSection';
import { PageContainer } from '@/components/PageContainer';

// The "Your drafts" list, split out of the wizard (GitHub issue #358,
// Phase 34) onto its own route — gated behind candidate login, unlike
// drafting itself (pure client-side state, no session needed until
// submit). Drafts are still just localStorage, not actually tied to any
// server-side session; this is a presentation-layer gate only, matching
// the project owner's request that this view not be wanderable into
// anonymously the way the old inline list on the wizard was.
export default function DraftsPage() {
  const router = useRouter();
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [drafts, setDrafts] = useState<ProcessDraft[]>([]);

  useEffect(() => {
    setLoggedIn(api.hasCandidateSessionHint());
  }, []);

  useEffect(() => {
    setDrafts(listDrafts());
  }, []);

  function handleResume(draft: ProcessDraft) {
    router.push(`/write-review?draftId=${draft.id}`);
  }

  function handleDelete(id: string) {
    if (!window.confirm('Delete this draft? This cannot be undone.')) return;
    deleteDraft(id);
    setDrafts(listDrafts());
  }

  return (
    <PageContainer>
      <header>
        <h1 className="text-2xl font-semibold">Your drafts</h1>
        <p className="text-sm text-gray-500">
          Resume an in-progress review, or find a company from the{' '}
          search page to write a new one.
        </p>
      </header>

      <GatedSection loggedIn={loggedIn} prompt="Log in to see your drafts.">
        <Card as="section" className="flex flex-col gap-3">
          {drafts.length === 0 ? (
            <EmptyState message="You have no drafts in progress." />
          ) : (
            <ul className="flex flex-col gap-2">
              {drafts.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span>
                    {d.companyName} — {d.process.roleTitle || 'Untitled process'}
                  </span>
                  <span className="flex gap-2">
                    <Button type="button" onClick={() => handleResume(d)}>
                      Resume
                    </Button>
                    <Button type="button" variant="danger" onClick={() => handleDelete(d.id)}>
                      Delete
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </GatedSection>
    </PageContainer>
  );
}
