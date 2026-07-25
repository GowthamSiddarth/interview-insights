// GitHub issue #287 (Phase 28) — a round's title is optional; every
// display site formats a round as "{Type} - {Title}" when a title exists,
// or just "{Type}" (no trailing dash, no "untitled" placeholder) when it
// doesn't. `typeLabel` is the already-humanized round type label (e.g.
// "Coding"), not the raw enum value.
export function formatRoundLabel(typeLabel: string, title?: string | null): string {
  return title ? `${typeLabel} - ${title}` : typeLabel;
}
