# Phase 43, Issue #617 — Landing Page Redesign: Hero + Card Grid

*Part of Phase 43 — Design System Refresh & Theming.
See `docs/ROADMAP.md` Phase 43.*

## The gap this closed

The Phase 33 search-first landing page worked but looked like a
scaffold: a plain heading, a search box, and quick-select companies
rendered as bare pill-shaped links with nothing but a name. This issue
restyled the hero and replaced the pill list with `CompanyCard` —
without touching a single line of the page's actual logic (search,
the create-company-request flow, the gating, the confirmation modal
all stayed exactly as they were).

## Key concept: check what the data actually has before designing around it

The design brief this phase started from mocked up company cards with
a score chip — a small rating badge next to each company name. Before
building that, it was worth checking whether the data backing the
landing page's company list could support it:

```ts
// src/lib/api.ts
export interface Company {
  id: string; name: string; slug: string;
  industry: string | null; sizeBucket: Company['sizeBucket'];
  logoUrl: string | null; createdAt: string;
}
```

No score field. Aggregate scores are computed per-company, on demand,
by a separate analytics endpoint (`/companies/:id/analytics`) — never
returned in bulk for a list. Building the score chip anyway would mean
either fabricating a number or firing N analytics requests for a
five-company grid. Both are worse than the honest answer: the mockup's
score chip doesn't ship in this issue, noted directly in
`CompanyCard`'s own comment so the gap isn't silently forgotten, and a
bulk-scores endpoint is flagged as the (backend) prerequisite for
picking it up later.

## Key concept: an accessible name that isn't the whole card's text

```tsx
<Link
  href={`/companies/${company.slug}`}
  aria-label={company.name}
  className="flex flex-col gap-2 rounded-xl border …"
>
  {/* avatar, name, industry/size line */}
</Link>
```

Turning a plain link into a richer card means more visible text inside
it — an industry/size line under the name. Without `aria-label`, the
link's accessible name becomes every visible string concatenated
("AmazonEnterprise"), breaking the existing
`getByRole('link', { name: 'Amazon' })`-style test assertions and
handing screen-reader users a run-on string instead of a clean
destination name. Pinning `aria-label` to just the company name keeps
the accessible name exactly what it was before the card existed, while
sighted users still get the extra context.

## Key concept: deterministic color where there's no real logo

```ts
// src/lib/avatar-color.ts
const AVATAR_COLORS = ['bg-indigo-600', 'bg-violet-600', 'bg-teal-600', /* … */];
export function avatarColorFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}
```

`logoUrl` exists on `Company` but no seeded company sets it, and no
`next/image` remote-domain allowlist exists yet — so the initial-letter
avatar path is what actually renders today. A fixed, small palette
(not a randomly generated hue per company) reads as a deliberate
choice, and hashing the name means the same company always gets the
same color everywhere it appears — this helper is shared with #618's
profile-page hero avatar for exactly that reason.

## Verification

Full suite green (212/212, five new `CompanyCard` tests covering the
accessible-name pin, the industry/size-bucket fallback, and both the
logo and no-logo avatar paths), lint/build clean. Real-browser
verification used Playwright's request interception to stub
`/companies/top` — not a mock in the Storybook sense, a real render of
the real component tree, just sidestepping the local dev CORS gap at
the network layer so the card grid could actually be seen rendering
with data, in both themes.
