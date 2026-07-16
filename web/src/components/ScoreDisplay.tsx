// Never render null/undefined/0 as if it were a real score (CLAUDE.md hard
// constraint #3) — a null score always means "under the n=3 shrinkage
// floor", not "zero". Always show sampleSize too, even when the score is
// null, per docs/DATA_MODEL.md D4: transparency, not a hidden gate.
export function ScoreDisplay({
  label,
  value,
  sampleSize,
  suffix = '',
}: {
  label: string;
  value: number | null;
  sampleSize: number;
  suffix?: string;
}) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-gray-500">{label}</dt>
      {value === null ? (
        <dd className="text-sm text-gray-500 italic">Not enough reviews yet</dd>
      ) : (
        <dd className="text-lg font-semibold">
          {value.toFixed(2)}
          {suffix}
        </dd>
      )}
      <span className="text-xs text-gray-400">
        {sampleSize} {sampleSize === 1 ? 'review' : 'reviews'}
      </span>
    </div>
  );
}
