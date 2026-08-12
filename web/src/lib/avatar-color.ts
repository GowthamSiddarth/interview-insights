// Fixed set, not a generated hue — same reasoning as the status/chart
// palettes (docs/DECISIONS.md D100): a small deterministic pool reads
// as "chosen," a random hue per company wouldn't be reproducible or
// reviewable. Shared between CompanyCard's grid avatars (#617) and the
// company profile header's hero avatar (#618) so the same company
// always gets the same color in both places.
const AVATAR_COLORS = ['bg-indigo-600', 'bg-violet-600', 'bg-teal-600', 'bg-amber-600', 'bg-rose-600', 'bg-emerald-600'];

export function avatarColorFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}
