'use client';

import { use, useEffect, useState } from 'react';
import { api, ApiError, CompanyAnalytics } from '@/lib/api';
import { ScoreDisplay } from '@/components/ScoreDisplay';

function roundTypeLabel(roundType: string): string {
  return roundType
    .split('_')
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ');
}

export default function CompanyAnalyticsPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = use(params);
  const [analytics, setAnalytics] = useState<CompanyAnalytics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getCompanyAnalytics(companyId)
      .then(setAnalytics)
      .catch((err: unknown) => setError(err instanceof ApiError ? err.message : 'Something went wrong.'));
  }, [companyId]);

  if (error) {
    return (
      <main className="mx-auto max-w-2xl p-8">
        <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      </main>
    );
  }

  if (!analytics) {
    return (
      <main className="mx-auto max-w-2xl p-8">
        <p className="text-sm text-gray-500">Loading…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-8 p-8">
      <header>
        <h1 className="text-2xl font-semibold">Company Analytics</h1>
        <p className="text-sm text-gray-500">
          All scores are shrinkage-adjusted toward the platform-wide average — see
          docs/DECISIONS.md D4. Every score shows its sample size alongside it, even when
          there isn&apos;t enough data to display a number yet.
        </p>
      </header>

      <section className="flex flex-col gap-3 rounded border border-gray-200 p-4 dark:border-gray-700">
        <h2 className="font-medium">Overall experience</h2>
        {analytics.overall ? (
          <dl className="grid grid-cols-2 gap-4">
            <ScoreDisplay
              label="Overall experience"
              value={analytics.overall.scores.overallExperience}
              sampleSize={analytics.overall.sampleSize}
            />
            <ScoreDisplay
              label="Would recommend"
              value={analytics.overall.scores.wouldRecommendPct}
              sampleSize={analytics.overall.sampleSize}
              suffix="%"
            />
          </dl>
        ) : (
          <p className="text-sm text-gray-500 italic">Not enough reviews yet</p>
        )}
      </section>

      <section className="flex flex-col gap-3 rounded border border-gray-200 p-4 dark:border-gray-700">
        <h2 className="font-medium">By round type</h2>
        {analytics.roundTypes.length === 0 ? (
          <p className="text-sm text-gray-500 italic">Not enough reviews yet</p>
        ) : (
          <div className="flex flex-col gap-4">
            {analytics.roundTypes.map((rt) => (
              <div key={rt.roundType}>
                <h3 className="mb-2 text-sm font-medium">{roundTypeLabel(rt.roundType)}</h3>
                <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                  <ScoreDisplay
                    label="Difficulty"
                    value={rt.scores.difficulty}
                    sampleSize={rt.sampleSize}
                  />
                  <ScoreDisplay
                    label="Fairness"
                    value={rt.scores.fairness}
                    sampleSize={rt.sampleSize}
                  />
                  <ScoreDisplay
                    label="Communication"
                    value={rt.scores.communicationFluency}
                    sampleSize={rt.sampleSize}
                  />
                  <ScoreDisplay
                    label="Attentiveness"
                    value={rt.scores.attentiveness}
                    sampleSize={rt.sampleSize}
                  />
                  <ScoreDisplay
                    label="Bias signal"
                    value={rt.scores.biasSignal}
                    sampleSize={rt.sampleSize}
                  />
                </dl>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3 rounded border border-gray-200 p-4 dark:border-gray-700">
        <h2 className="font-medium">Recruiter experience</h2>
        {analytics.recruiter ? (
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <ScoreDisplay
              label="Approachability"
              value={analytics.recruiter.scores.approachability}
              sampleSize={analytics.recruiter.sampleSize}
            />
            <ScoreDisplay
              label="Response time"
              value={analytics.recruiter.scores.responseTime}
              sampleSize={analytics.recruiter.sampleSize}
            />
            <ScoreDisplay
              label="Timeliness"
              value={analytics.recruiter.scores.timeliness}
              sampleSize={analytics.recruiter.sampleSize}
            />
            <ScoreDisplay
              label="Communication quality"
              value={analytics.recruiter.scores.communicationQuality}
              sampleSize={analytics.recruiter.sampleSize}
            />
          </dl>
        ) : (
          <p className="text-sm text-gray-500 italic">Not enough reviews yet</p>
        )}
      </section>
    </main>
  );
}
