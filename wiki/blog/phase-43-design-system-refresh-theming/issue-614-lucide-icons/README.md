# Phase 43, Issue #614 — Icon System: Adopting `lucide-react`

*Part of Phase 43 — Design System Refresh & Theming.
See `docs/ROADMAP.md` Phase 43.*

## The gap this closed

The app had exactly one piece of iconography anywhere: `BrandMark`'s
inline SVG star (Phase 23, D42). Every affordance elsewhere was text
— the theme toggle's Light/Dark/System labels, empty states, nav
controls. This issue picked one icon library and applied it at the
two places that most needed it, deliberately leaving the rest for
later issues where icons have real context to attach to.

## Key concept: verify "zero-dependency" instead of assuming it

`lucide-react` is reputed to ship with no runtime dependencies beyond
a React peer. Reputation isn't verification:

```
$ git diff --stat web/package-lock.json
 web/package-lock.json | 10 ++++++++++
 1 file changed, 10 insertions(+)
```

Ten lines. No new transitive packages. That's the actual confirmation
— checked, not assumed — before treating the dependency as low-risk.
The same discipline applied to the unrelated `npm audit` output the
install surfaced: six pre-existing high-severity findings in `next`,
`postcss`, `sharp`, `js-yaml`, `nanoid`, and `brace-expansion`. None
of those packages appear anywhere in `lucide-react`'s own dependency
tree; the lockfile diff proves it, rather than a plausible-sounding
"probably fine."

## Key concept: one generic icon beats twelve bespoke guesses

```tsx
// src/components/EmptyState.tsx
export function EmptyState({ message }: { message: string }) {
  return (
    <p className="flex items-center gap-1.5 text-sm text-gray-500 italic">
      <Inbox aria-hidden="true" className="h-4 w-4 shrink-0" />
      {message}
    </p>
  );
}
```

`EmptyState` has twelve call sites — search no-match, an empty
drafts list, an empty moderation queue, no staff accounts yet, and
more — each with different copy but the identical job: say "nothing
here" explicitly. A bespoke icon per context would mean twelve design
decisions this issue has no basis for making well; a single `Inbox`
icon, `aria-hidden` since the message text alone already carries the
meaning, covers the actual job at every call site without inventing
per-page nuance that belongs to that page's own future redesign
issue.

## Verification

203/203 tests (one new: `EmptyState` renders its icon with
`aria-hidden="true"`), lint and build clean. Real-browser check
confirmed the `ThemeToggle` icons render correctly in both themes.
`EmptyState`'s icon in its actual triggered context (a real zero-result
search) hit the same pre-existing local-dev CORS gap #612/#613 already
documented — the search request never completes, so the page never
reaches the zero-results branch locally. Verified via the component
test instead, which renders the real component and asserts on its
real output, rather than claiming success on an interaction that
couldn't actually be driven end-to-end in this environment.
