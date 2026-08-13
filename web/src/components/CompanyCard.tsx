import Link from 'next/link';
import { Company } from '@/lib/api';

// Fixed set, not a generated hue — same reasoning as the status/chart
// palettes: a small deterministic pool reads as "chosen," a random hue
// per company wouldn't be reproducible or reviewable.
const AVATAR_COLORS = ['bg-indigo-600', 'bg-violet-600', 'bg-teal-600', 'bg-amber-600', 'bg-rose-600', 'bg-emerald-600'];

function avatarColorFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

interface CompanyCardProps {
  company: Company;
}

// GitHub issue #617 — replaces the landing page's plain quick-select
// pill buttons with a proper card: a logo (company.logoUrl when set,
// otherwise a deterministic colored-initial avatar so the grid isn't a
// wall of identical gray circles — logoUrl is optional at creation and
// no seed company sets it today, so the avatar path is what actually
// renders in practice) plus name and industry/size.
//
// No score/rating chip here, unlike the design brief's mockup —
// company list endpoints (Company, CompanySearchResult) don't return
// aggregate scores; that's only computed per-company on
// /companies/[slug]/analytics. Adding a bulk-scores endpoint is a
// backend change, out of scope for this frontend-only phase.
export function CompanyCard({ company }: CompanyCardProps) {
  return (
    <Link
      href={`/companies/${company.slug}`}
      // Accessible name pinned to just the company name (not the
      // concatenated card text, which would otherwise include the
      // industry/size line too) — matches the plain-link accessible
      // name the quick-select list had before this was a card, so
      // "go to this company's profile" stays a one-word link name for
      // assistive tech even though sighted users see more context.
      aria-label={company.name}
      className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-3 text-left shadow-sm transition-colors hover:border-indigo-300 hover:shadow-md dark:border-gray-700 dark:bg-gray-900 dark:hover:border-indigo-600"
    >
      <div className="flex items-center gap-2">
        {company.logoUrl ? (
          // Plain <img>, not next/image — logoUrl is an arbitrary
          // external URL (no seeded company has one today, no domain
          // allowlist configured yet), so next/image's remote-domain
          // config would be guessing at hosts that don't exist yet.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={company.logoUrl} alt="" className="h-8 w-8 rounded-lg object-cover" />
        ) : (
          <span
            aria-hidden="true"
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-semibold text-white ${avatarColorFor(company.name)}`}
          >
            {company.name.charAt(0).toUpperCase()}
          </span>
        )}
        <span title={company.name} className="truncate text-sm font-medium">
          {company.name}
        </span>
      </div>
      <span className="text-xs text-gray-500 dark:text-gray-400">
        {company.industry ?? company.sizeBucket.charAt(0).toUpperCase() + company.sizeBucket.slice(1)}
      </span>
    </Link>
  );
}
