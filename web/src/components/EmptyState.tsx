// A search that returns zero results must say so explicitly — never a
// silently empty list indistinguishable from "still loading" or "haven't
// searched yet" (docs/ROADMAP.md Phase 5 issue #23 scope).
export function EmptyState({ message }: { message: string }) {
  return <p className="text-sm text-gray-500 italic">{message}</p>;
}
