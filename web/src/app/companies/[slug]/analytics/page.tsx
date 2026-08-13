'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { api, ApiError, CompanyAnalytics } from '@/lib/api';
import { StatTile } from '@/components/StatTile';
import { GatedSection } from '@/components/GatedSection';
import { Card } from '@/components/Card';
import { PageContainer } from '@/components/PageContainer';

function roundTypeLabel(roundType: string): string {
  return roundType
    .split('_')
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ');
}

// GitHub issue #619 — one hue, lightness carries magnitude (docs/
// DECISIONS.md D100's --chart-seq-1..5 tokens, defined in #612 for
// exactly this, unused until now). Round type is a category label
// here, not a competing series, so it doesn't need its own hue —
// distinguishing five *difficulty levels* of the same metric is a
// magnitude job, not an identity job (dataviz skill's form heuristic).
function seqStepFor(value: number, max: number): number {
  const fraction = Math.max(0, Math.min(1, value / max));
  return Math.min(5, Math.max(1, Math.ceil(fraction * 5)));
}

// value is nullable — a round type having enough *samples* overall
// doesn't guarantee every individual metric clears the shrinkage floor
// on its own (CLAUDE.md hard constraint #3); an empty track, not a
// hidden zero-width bar, same rule ScoreRing/StatTile apply elsewhere.
function DifficultyBar({ roundType, value, max = 5 }: { roundType: string; value: number | null; max?: number }) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr_3rem] items-center gap-3">
      {/* GitHub issue #622 — a fixed-width label column, not
          minmax(0,1fr): the flexible version let the bar/value columns
          crowd it out on narrow viewports, truncating real round-type
          names ("System Design" → "System ..."). 7.5rem comfortably
          fits every current round-type label at every viewport width. */}
      <span className="truncate text-sm text-gray-600 dark:text-gray-400">{roundTypeLabel(roundType)}</span>
      <div className="h-2.5 rounded-full bg-gray-100 dark:bg-gray-800">
        {value !== null && (
          <div
            className="h-full rounded-full"
            style={{
              width: `${Math.max(0, Math.min(1, value / max)) * 100}%`,
              backgroundColor: `var(--chart-seq-${seqStepFor(value, max)})`,
            }}
          />
        )}
      </div>
      <span className="text-right font-mono text-sm tabular-nums text-gray-600 dark:text-gray-400">
        {value !== null ? value.toFixed(1) : '—'}
      </span>
    </div>
  );
}

export default function CompanyAnalyticsPage() {
  // useParams() over the params-prop-as-Promise pattern: synchronous, no
  // Suspense boundary required — simpler here and in every test of this
  // page (a bare RTL render() doesn't get App Router's automatic Suspense
  // wrapper, which the Promise+use() pattern needs).
  const { slug } = useParams<{ slug: string }>();
  const [analytics, setAnalytics] = useState<CompanyAnalytics | null>(null);
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Session-hint cookie, not a GET /auth/me poll — same tri-state idiom
  // NavBar/the wizard already use (D32): null while unchecked, so the gate
  // never flashes before the real state is known.
  const [candidateSession, setCandidateSession] = useState<boolean | null>(null);

  useEffect(() => {
    setCandidateSession(api.hasCandidateSessionHint());
  }, []);

  useEffect(() => {
    // Profile pages address companies by slug (Phase 15) — this route
    // matches that scheme too, resolving to the id the analytics endpoint
    // itself still takes.
    api
      .getCompanyBySlug(slug)
      .then((company) => {
        setCompanyName(company.name);
        return api.getCompanyAnalytics(company.id);
      })
      .then(setAnalytics)
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : 'Something went wrong.'));
  }, [slug]);

  if (error) {
    return (
      <PageContainer size="wide">
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      </PageContainer>
    );
  }

  if (!analytics) {
    return (
      <PageContainer size="wide">
        <p className="text-sm text-gray-500">Loading…</p>
      </PageContainer>
    );
  }

  return (
    <PageContainer size="wide">
      <header>
        <h1 className="text-2xl font-semibold">Company Analytics</h1>
        {/* Scores are shrinkage-adjusted toward the platform-wide average
            (docs/DECISIONS.md D4) rather than shown as a raw average. */}
        <p className="text-sm text-gray-500">
          Scores are weighted toward the platform average when a company has few
          reviews, so a couple of ratings can&apos;t swing the number too far. Every
          score shows how many reviews it&apos;s based on, even when there isn&apos;t
          enough data to display one yet.
        </p>
        <Link
          href={`/companies/${slug}`}
          className="text-sm text-indigo-600 underline transition-colors hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
        >
          Back to company profile
        </Link>
      </header>

      <GatedSection
        loggedIn={candidateSession}
        prompt={`Log in to see the full analytics breakdown for ${companyName ?? 'this company'}`}
      >
        <Card as="section" className="flex flex-col gap-3">
          <h2 className="font-medium">Overall experience</h2>
          {analytics.overall ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile
                label="Overall experience"
                value={analytics.overall.scores.overallExperience}
                sampleSize={analytics.overall.sampleSize}
              />
              <StatTile
                label="Would recommend"
                value={analytics.overall.scores.wouldRecommendPct}
                sampleSize={analytics.overall.sampleSize}
                suffix="%"
              />
            </div>
          ) : (
            <p className="text-sm text-gray-500 italic">Not enough reviews yet</p>
          )}
        </Card>

        <Card as="section" className="flex flex-col gap-4">
          <h2 className="font-medium">By round type</h2>
          {analytics.roundTypes.length === 0 ? (
            <p className="text-sm text-gray-500 italic">Not enough reviews yet</p>
          ) : (
            <>
              {/* Difficulty first, as a magnitude comparison across every
                  round type at once — the one metric worth comparing
                  side-by-side. Fluency/clarity/focus (interviewer traits,
                  not round properties) follow per round type below, where
                  "per round type" is the meaningful grouping for them. */}
              <div className="flex flex-col gap-3">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  Difficulty
                </p>
                {analytics.roundTypes.map((rt) => (
                  <DifficultyBar key={rt.roundType} roundType={rt.roundType} value={rt.scores.difficulty} />
                ))}
              </div>

              <div className="flex flex-col gap-4 border-t border-gray-200 pt-4 dark:border-gray-700">
                {analytics.roundTypes.map((rt) => (
                  <div key={rt.roundType}>
                    <h3 className="mb-2 text-sm font-medium">{roundTypeLabel(rt.roundType)}</h3>
                    <div className="grid grid-cols-3 gap-3">
                      <StatTile label="Fluency" value={rt.scores.fluency} sampleSize={rt.sampleSize} />
                      <StatTile label="Clarity" value={rt.scores.clarity} sampleSize={rt.sampleSize} />
                      <StatTile label="Focus" value={rt.scores.focus} sampleSize={rt.sampleSize} />
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>

        <Card as="section" className="flex flex-col gap-3">
          <h2 className="font-medium">Recruiter experience</h2>
          {analytics.recruiter ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <StatTile
                label="Reachability"
                value={analytics.recruiter.scores.reachability}
                sampleSize={analytics.recruiter.sampleSize}
              />
              <StatTile
                label="Responsiveness"
                value={analytics.recruiter.scores.responsiveness}
                sampleSize={analytics.recruiter.sampleSize}
              />
              <StatTile
                label="Guidelines shared"
                value={analytics.recruiter.scores.guidelinesShared}
                sampleSize={analytics.recruiter.sampleSize}
              />
            </div>
          ) : (
            <p className="text-sm text-gray-500 italic">Not enough reviews yet</p>
          )}
        </Card>
      </GatedSection>
    </PageContainer>
  );
}
