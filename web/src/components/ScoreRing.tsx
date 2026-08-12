// The hero-score treatment for the company profile header (GitHub
// issue #618) — a separate component from ScoreDisplay, not a
// modification of it: ScoreDisplay's plain dt/dd pair is still exactly
// right for the analytics page's grid of many scores at once (#619
// migrates that page's own usage on its own terms), this is only for
// the one or two scores a profile header foregrounds.
//
// Never renders a filled ring for a null value — same shrinkage rule
// as ScoreDisplay (CLAUDE.md hard constraint #3, docs/DATA_MODEL.md):
// a null score always means "under the n=3 floor," shown as an empty
// track, never a hidden zero.
const RADIUS = 26;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

interface ScoreRingProps {
  label: string;
  value: number | null;
  sampleSize: number;
  max?: number;
  suffix?: string;
}

export function ScoreRing({ label, value, sampleSize, max = 5, suffix = '' }: ScoreRingProps) {
  const fraction = value === null ? 0 : Math.max(0, Math.min(1, value / max));
  const dashoffset = CIRCUMFERENCE * (1 - fraction);

  return (
    <div className="flex items-center gap-3">
      <div className="relative h-16 w-16 shrink-0">
        <svg width="64" height="64" viewBox="0 0 64 64" className="-rotate-90">
          <circle cx="32" cy="32" r={RADIUS} fill="none" strokeWidth="5" className="stroke-gray-200 dark:stroke-gray-700" />
          {value !== null && (
            <circle
              cx="32"
              cy="32"
              r={RADIUS}
              fill="none"
              strokeWidth="5"
              strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={dashoffset}
              className="stroke-indigo-600 dark:stroke-indigo-400"
            />
          )}
        </svg>
        {value !== null && (
          <span className="absolute inset-0 flex items-center justify-center font-mono text-sm font-medium tabular-nums">
            {value.toFixed(1)}
            {suffix}
          </span>
        )}
      </div>
      <dl>
        <dt className="text-xs text-gray-500 dark:text-gray-400">{label}</dt>
        {value === null ? (
          <dd className="text-sm italic text-gray-500 dark:text-gray-400">Not enough reviews yet</dd>
        ) : (
          <dd className="text-sm text-gray-600 dark:text-gray-300">
            {sampleSize} {sampleSize === 1 ? 'review' : 'reviews'}
          </dd>
        )}
      </dl>
    </div>
  );
}
