// A small inline SVG mark (GitHub issue #236, Phase 23) — no external
// image asset, same self-contained approach next/font already uses for
// typography. A star ties into the product's core "rating" concept.
export function BrandMark({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <rect width="24" height="24" rx="6" className="fill-indigo-600" />
      <path
        d="M12 5.5l1.9 3.85 4.25.62-3.08 3 .73 4.23L12 15.15l-3.8 2.05.73-4.23-3.08-3 4.25-.62L12 5.5z"
        className="fill-white"
      />
    </svg>
  );
}
