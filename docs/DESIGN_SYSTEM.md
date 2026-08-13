# Design System

A single reference for this app's visual language: color tokens,
typography, spacing, iconography, theming, and the shared component
library — each grounded in what's actually shipped in `web/src`, not
aspirational. Companion to `docs/DECISIONS.md` D100 (the token
*strategy* — why a palette remap instead of a component rewrite) and
`wiki/blog/phase-43-design-system-refresh-theming/` (the *narrative*,
one post per issue). This doc is the *reference*: what a token's hex
value is today, what a component's prop API looks like, which
component to reach for.

Phase 43 (epic #611) built this system. Before it, `web/` ran on stock
Tailwind `gray-*`/`indigo-600` with no token layer and no way for a
visitor to choose a theme — see that epic and its blog posts for the
full before/after reasoning.

## Direction

A "structured evaluation" visual identity — not a generic SaaS reskin,
and deliberately not a comp-transparency tool's layout borrowed
wholesale. Built around this product's own shape: per-round
difficulty, three named interviewer traits, shrinkage-adjusted
aggregates that can legitimately be "not enough data yet." Score
displays read as calibrated instrument readings, not just numbers in a
sentence; status is never conveyed by color alone.

## Color

### Neutral scale

Tailwind's stock `gray` palette, remapped to a cool, slate-leaning
scale in `web/tailwind.config.ts` (`theme.extend.colors.gray`).
Because every component already references `gray-*` by class name —
never an arbitrary hex — this one config change is the entire neutral
refresh; no component file needed to change.

| Step | Hex | Typical role |
|---|---|---|
| 50 | `#f6f7fb` | Page background (light) |
| 100 | `#eef0f6` | Subtle fills |
| 200 | `#e2e5ee` | Borders (light) |
| 300 | `#cbd0dd` | Stronger borders, disabled text |
| 400 | `#9aa3b5` | Placeholder / tertiary text |
| 500 | `#6b7280` | Secondary text (both themes — no dark override on most call sites) |
| 600 | `#4b5768` | — |
| 700 | `#37414f` | Borders (dark) |
| 800 | `#2a3340` | — |
| 900 | `#1b222d` | Card background (dark), primary text (light) |
| 950 | `#10141c` | Page background (dark) |

### Brand accent

Tailwind's stock `indigo` palette, remapped to teal in the same file
(`theme.extend.colors.indigo`) — chosen so every existing
`bg-indigo-600`/`text-indigo-600`/etc. class updates automatically.
Only the shades this app actually references are overridden; any
`indigo` shade not listed here still resolves to Tailwind's stock
blue-violet (nothing renders it).

| Step | Hex | Typical role |
|---|---|---|
| 50 | `#e6f5f4` | Badge/chip tint background |
| 300 | `#7fd0c8` | Dark-mode hover state (badges, links) |
| 400 | `#3fd1cb` | Dark-mode primary text/links |
| 500 | `#14a39b` | Focus rings |
| 600 | `#0e7c86` | Primary buttons, light-mode links |
| 700 | `#0a6670` | Hover state (light-mode buttons/links), badge ink |
| 950 | `#062023` | Dark-mode badge tint background |

**Interaction pattern, preserved by design:** hover darkens a shade in
light mode (600→700), hover lightens a shade in dark mode (400→300); a
`-50`/`-950` tint background always pairs with a `-700`/`-300` ink
text color for badges. New teal shades were chosen to keep these
existing relationships intact.

`red` and `amber` are **untouched** — no design direction called for
changing the error/warning hues, and Tailwind's stock scales there
already clear the same contrast bar the new scales were checked
against.

### Status vocabulary (reserved, never generic)

CSS custom properties in `web/src/app/globals.css`, switching on the
same `.dark` class Tailwind's `dark:` variant uses (not a separate
mechanism). Four tones, each with a raw hue (fills, icon strokes) and
a separate `-ink` variant (**text color**, always — never the raw
hue):

| Tone | Raw (light) | Ink (light) | Raw (dark) | Ink (dark) | Meaning |
|---|---|---|---|---|---|
| `good` | `#0ca30c` | `#0d7a0d` | `#24b524` | `#24b524` | Approved, active |
| `warning` | `#fab219` | `#8a5a0a` | `#fab219` | `#fab219` | Pending |
| `serious` | `#ec835a` | `#a1472a` | `#ec835a` | `#ec835a` | Flagged |
| `critical` | `#d03b3b` | `#b23030` | `#e2564f` | `#f0837c` | Rejected, deactivated |

**Why the `-ink` split exists at all:** the raw `warning`/`serious`
hues measure 1.79:1 and 2.57:1 against a light surface — they fail
outright as text color, full stop, regardless of any icon sitting next
to them. Dark-mode `critical-ink` is the one tone that needed its own
lighter shade rather than reusing the raw hue: `#622` (the phase's
accessibility audit) measured `#e2564f` at 3.62:1 against
`StatusPill`'s real composited background using a script that reads
actual browser-computed styles — Chromium serializes `color-mix()`
output as `oklab()`, not `rgb()` — not a hand-derived guess. Passes
AA-large, fails AA-normal at the pill's real 12px size. Lightened to
`#f0837c` (5.26:1). `--status-critical` itself (fills/icons) kept the
original hue; only the text-specific token changed.

**Rule:** a status is never conveyed by color alone — every tone ships
with an icon and a label. See [`StatusPill`](#statuspill) below.

### Sequential ramp (magnitude, one hue)

For comparing the same metric across categories (e.g. difficulty
across round types) — lightness carries magnitude, not a different
hue per category. Category identity and metric magnitude are different
jobs; conflating them into "one color per round type" would imply a
comparison that isn't there.

| Step | Light | Dark |
|---|---|---|
| 1 (lowest) | `#cdeded` | `#123634` |
| 2 | `#96d9d2` | `#1b5450` |
| 3 | `#5cc0b8` | `#2a8a82` |
| 4 | `#2a9990` | `#45bdb4` |
| 5 (highest) | `#0e7075` | `#7be0d8` |

Used today by `DifficultyBar` on `/companies/[slug]/analytics` (see
`web/src/app/companies/[slug]/analytics/page.tsx`) — `seqStepFor()`
buckets a 0–5 value into one of the five steps.

### Elevation

Two shadow tokens, `--shadow-card` and `--shadow-raised`, also in
`globals.css`, also theme-aware. `Card` (the base surface component)
uses `shadow-sm` from Tailwind directly rather than these tokens
today; they're available for anything needing a second elevation tier
(e.g. a future modal/popover) without inventing new shadow values
ad hoc.

## Typography

**Inter only** (`next/font/google`, self-hosted at build time — see
`web/src/app/layout.tsx`), the `--font-sans` CSS variable, applied via
Tailwind's `font-sans`. No serif or monospace display face anywhere in
the shipped app.

> The Phase 43 planning artifact (a Claude-hosted design brief, not
> checked into this repo) proposed an IBM Plex Serif/Sans/Mono trio —
> serif for headings, sans for body, mono for data — as part of its
> "structured evaluation" pitch. **That pairing was never adopted.**
> Every implementation issue (#612–#622) kept Inter throughout; only
> the color palette changed. If a future issue wants that type system,
> it's a real, separate scope decision — not something to assume
> already happened because a mockup once showed it.

`font-mono`/`tabular-nums` (system monospace stack, not a custom
webfont) is used for data that needs to align in a column: score
values (`ScoreRing`, `StatTile`), the theme toggle has none, chart bar
values. See any component below using `font-mono text-*
tabular-nums`.

## Spacing & radius

No named spacing/radius tokens — Tailwind's default scale, used
consistently by convention rather than enforced by a config:

| Radius class | Used for |
|---|---|
| `rounded-md` | Buttons, inputs, small containers |
| `rounded-lg` | Avatar squares (`CompanyCard`, profile hero) |
| `rounded-xl` | Cards, tiles (`Card`, `StatTile`, `CompanyCard`) |
| `rounded-full` | Pills, chips, badges, avatar circles |

Card padding is `p-3` (tiles, compact cards) or `p-4` (`Card`, the
page-level surface). Gaps between related items step through
Tailwind's `gap-1`/`gap-1.5`/`gap-2`/`gap-3`/`gap-4` by visual
density, tightest for icon+label pairs, widest between page sections.

## Iconography

[`lucide-react`](https://lucide.dev) — adopted in #614, confirmed
dependency-free (the `package-lock.json` diff added exactly 10 lines,
no new transitive packages).

- **Sizing:** `h-3 w-3` inside an inline pill/badge (`StatusPill`),
  `h-3.5 w-3.5` inside a compact button (`ThemeToggle`), `h-4 w-4` as
  a standalone affordance (`EmptyState`), `h-5 w-5` for nav-level
  controls (`NavBar`'s hamburger).
- **Rule:** every icon that sits next to a text label is
  `aria-hidden="true"` — the label already carries the meaning, the
  icon is reinforcement, not information. An icon is only exposed to
  assistive tech when it's the *only* content of an interactive
  element (none currently are).

## Theming: light / dark / system

Mechanism lives in `web/src/lib/theme.ts`. Three pieces:

1. **`darkMode: 'class'`** in `tailwind.config.ts` (not the Tailwind
   default `'media'`) — a visitor's stored choice drives `dark:`
   classes, not just the OS preference.
2. **A FOUC-safe bootstrap script** (`themeInitScript()`), inlined as
   a blocking `<script>` in `layout.tsx`'s `<head>` — runs before
   hydration, applies the `dark` class immediately so there's no flash
   of the wrong theme. Falls back to `matchMedia('(prefers-color-scheme:
   dark)')` when nothing is stored.
3. **`getStoredThemePreference()`/`applyThemePreference()`** — the
   real toggle logic `ThemeToggle` calls. `'system'` is represented by
   the *absence* of a stored `localStorage` key, never the literal
   string `'system'` — the bootstrap script and the toggle both read
   the same source of truth this way, with no second code path to
   drift out of sync.

```ts
import { applyThemePreference } from '@/lib/theme';

applyThemePreference('dark');   // stores 'dark', adds the class
applyThemePreference('system'); // clears the key, resolves from the OS
```

## Accessible primitives

[Radix UI](https://www.radix-ui.com) (`@radix-ui/react-dialog`,
`@radix-ui/react-tooltip`) — adopted in #615 for real focus-trap/
keyboard behavior a hand-rolled `useState` toggle didn't have.

- **`Dialog`** backs `ConfirmationModal`. Every dismissal path (the
  corner ✕, the primary action button, Escape, clicking the overlay)
  routes through one `onOpenChange` callback.
- **`Tooltip`** backs `HelpTooltip`. Needs exactly one
  `Tooltip.Provider` ancestor — already wired into `layout.tsx`,
  wrapping the whole app, so no page needs its own. `disableHoverableContent`
  is set deliberately: these are one-line definitions, not something
  a user needs to move their pointer into.
- **Not adopted:** `Tabs`, `DropdownMenu`. Originally scoped alongside
  Dialog/Tooltip; no call site ever needed them once the redesign
  issues actually landed (the company profile page, the one place a
  tabbed layout was mocked up, kept its real two-section shape instead
  — see `docs/ROADMAP.md` Phase 43, issue #618).

In tests, any component tree that includes a `HelpTooltip` needs a
`Tooltip.Provider` ancestor or Radix throws at render time. Import
`render` from `web/tests/test-utils.tsx` (the standard Testing-Library
"custom render" wrapper), not directly from `@testing-library/react`,
in any test whose tree might include one.

## Component reference

### `Button`

`web/src/components/Button.tsx`. Four variants (`primary` — default,
`danger`, `neutral`, `warning`), formalizing colors already in use
(Phase 23) rather than introducing new ones. Pass `href` to render a
real `<Link>` instead of a `<button>` — same visual classes — for
actions that are genuinely navigation; a `<button onClick={() =>
router.push(...)}>` loses right-click/open-in-new-tab/status-bar-preview.

```tsx
<Button variant="danger" onClick={handleReject}>Reject</Button>
<Button href={`/write-review?companyId=${id}`}>Write a review</Button>
```

### `Card`

`web/src/components/Card.tsx`. The one page-level surface —
`rounded-xl border bg-white p-4 shadow-sm` (dark-aware). `as="section"`
for a real page landmark (most call sites), `as="div"` (default) for
a one-off item.

### `Chip`

`web/src/components/Chip.tsx`. Small indigo-tinted pill for a
category/type label — round-type tags, moderation's category badge.
Not for status (see `StatusPill`) — `Chip` is identity/category,
`StatusPill` is state.

```tsx
<Chip>System Design</Chip>
```

### `StatusPill`

`web/src/components/StatusPill.tsx`. Icon + label, one of four
[status tones](#status-vocabulary-reserved-never-generic). The
`ENTITY_STATUS_TONE` map in `web/src/lib/status.ts` translates the
app's real `pending`/`approved`/`rejected`/`flagged` vocabulary into a
tone; other binary states (e.g. a staff account's active/deactivated)
pass a tone directly.

```tsx
import { ENTITY_STATUS_TONE } from '@/lib/status';

<StatusPill tone={ENTITY_STATUS_TONE[review.status]}>
  {statusLabel(review.status)}
</StatusPill>

<StatusPill tone={account.isActive ? 'good' : 'critical'}>
  {account.isActive ? 'Active' : 'Deactivated'}
</StatusPill>
```

### `ScoreRing` vs. `StatTile` vs. `ScoreDisplay` — which one to use

Three components render a score. They're not interchangeable — each
answers a different density question:

| Component | Format | Use for |
|---|---|---|
| `ScoreRing` | 1 decimal, a filled SVG ring | The one or two scores a page's **hero** foregrounds (company profile header) |
| `StatTile` | 2 decimals, a bordered tile | A **dense grid** of many scores at once (analytics dashboard) |
| `ScoreDisplay` | 2 decimals, plain `dt`/`dd` | Legacy — still used inline where a tile/ring would be heavier than the context needs |

All three share the same null rule (CLAUDE.md hard constraint #3,
`docs/DATA_MODEL.md`): a `null` value always means "under the n=3
shrinkage floor" and renders "Not enough reviews yet" — **never** a
hidden zero.

```tsx
<ScoreRing label="Overall experience" value={4.2} sampleSize={214} />
<ScoreRing label="Would recommend" value={81} sampleSize={214} max={100} suffix="%" />
<StatTile label="Difficulty" value={rt.scores.difficulty} sampleSize={rt.sampleSize} />
```

### `CompanyCard`

`web/src/components/CompanyCard.tsx`. Logo (`company.logoUrl` when
set — no seeded company has one today, so the fallback is what
actually renders) or a deterministic colored-initial avatar via
`avatarColorFor()` (`web/src/lib/avatar-color.ts`, a fixed 6-color
pool, hashed from the company name — shared with the profile page's
hero avatar so a company reads consistently everywhere). The link's
`aria-label` is pinned to just the company name, not the card's full
visible text (name + industry/size), so assistive tech gets a clean
destination name.

### `EmptyState`

`web/src/components/EmptyState.tsx`. One generic `Inbox` icon +
message, used at all 12 "nothing here" call sites across the app
(search no-match, empty drafts, empty moderation queue, ...) rather
than a bespoke icon per context.

### `ThemeToggle`

`web/src/components/ThemeToggle.tsx`. Three buttons (sun/moon/monitor
icons + Light/Dark/System labels), `aria-pressed` on the active one,
`role="group"` with `aria-label="Theme"` on the container. Rendered
once in `NavBar`, both in the desktop row and the mobile panel.

### `BrandMark`

`web/src/components/BrandMark.tsx`. A single inline SVG (Phase 23,
D42) — a star badge, no external image asset. Uses `fill-indigo-600`,
so it inherited the new teal automatically when the palette remapped;
never needed its own redesign.

## Accessibility rules, restated

- **Never color alone.** Status is icon + label (`StatusPill`); a
  score's null state is text ("Not enough reviews yet"), not a color
  change.
- **Text color comes from a token's `-ink` variant, never the raw
  hue**, when that distinction exists (status tones). Verify with real
  computed styles from a browser, not a hex-value calculator — Phase
  43's own `#622` audit caught a failure a manual check would have
  missed (`color-mix()` composites differently than a flat hex).
  `node <dataviz skill>/scripts/validate_palette.js` for any new
  categorical/sequential palette; a one-off token pairing like
  `-ink` needs the real-browser check `#622`'s audit script used.
- **Keyboard parity.** Every interactive primitive here (`Dialog`,
  `Tooltip`, `ThemeToggle`) has a direct test for Escape/Tab/Enter
  behavior — see `web/tests/confirmation-modal.spec.tsx`,
  `help-tooltip.spec.tsx`, `theme-toggle.spec.tsx`. A claim of
  "Radix gives us X for free" isn't verified until it has a test; see
  `#622`'s own finding that #615's claims were correct but untested
  for months.
- **Mobile.** Check real breakpoints with an actual narrow-viewport
  screenshot (Playwright at 375px), not a resized desktop browser
  window — `#622` caught a label-truncation bug that only a real
  screenshot pass surfaced.

## Known gaps / deliberately deferred

- **Score chips on company cards** (landing page, moderation) —
  `Company`/`CompanySearchResult` don't carry aggregate scores in bulk
  today; only computed per-company on the analytics endpoint. Needs a
  backend bulk-scores endpoint first.
- **A platform-wide stats strip** ("X companies · Y reviews") — no
  endpoint returns platform-wide counts today.
- **`Tabs`/`DropdownMenu`** — installed as Radix dependencies'
  siblings conceptually, never actually added to `package.json` since
  no shipped screen needed them.
- **IBM Plex typography** — see [Typography](#typography) above; the
  planning artifact's proposal, never implemented.

## Where things live

```
web/tailwind.config.ts          neutral + brand accent palettes
web/src/app/globals.css         status/chart/shadow CSS custom properties
web/src/lib/theme.ts            theme preference storage + bootstrap script
web/src/lib/status.ts           entity-status → StatusPill tone map
web/src/lib/avatar-color.ts     deterministic company avatar color
web/src/components/             every shared component referenced above
web/tests/test-utils.tsx        custom render() wrapper (Tooltip.Provider)
docs/DECISIONS.md               D100 — the token-remap strategy decision
docs/ROADMAP.md                 Phase 43 — full issue-by-issue scope/status
wiki/blog/phase-43-.../         one narrative post per issue, real bugs included
```
