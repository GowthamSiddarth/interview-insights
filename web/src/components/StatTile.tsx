// GitHub issue #619 — replaces the analytics page's dl grid of
// ScoreDisplay pairs with a compact tile, still 2-decimal formatted
// (unlike ScoreRing's 1-decimal hero treatment, #618) — this page is
// a dense grid of many scores at once, not a handful of foregrounded
// numbers, so ScoreDisplay's existing precision convention carries
// over rather than being restyled.
interface StatTileProps {
  label: string;
  value: number | null;
  sampleSize: number;
  suffix?: string;
}

export function StatTile({ label, value, sampleSize, suffix = '' }: StatTileProps) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm dark:border-gray-700 dark:bg-gray-900">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</p>
      {value === null ? (
        <p className="mt-1 text-sm italic text-gray-500 dark:text-gray-400">Not enough reviews yet</p>
      ) : (
        <p className="mt-1 font-mono text-xl font-medium tabular-nums">
          {value.toFixed(2)}
          {suffix}
        </p>
      )}
      <p className="text-xs text-gray-400 dark:text-gray-500">
        {sampleSize} {sampleSize === 1 ? 'review' : 'reviews'}
      </p>
    </div>
  );
}
