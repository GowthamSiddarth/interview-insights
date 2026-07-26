# Phase 34, Issue #360 — Search-Failure "Request a New Company" Flow

*Part of Phase 34 — Write-a-Review Flow Refinements. See
`docs/ROADMAP.md` Phase 34.*

## The gap this closed

Issue #358 moved the wizard to `/write-review` and, per D57, deleted
its old "no company context" state — including the create-company form
that used to live there. That form still needed a home: a candidate
whose company genuinely isn't in the system yet has no way to add it
anymore. The issue's own framing was specific about *where* that home
should be: a search that returns nothing is the one moment a candidate
has actually proven the company is missing, so that's the only place
this path should open from — not a standing nav link, not a button
visible from page load.

## Key concept: the button only exists inside the empty state, and only there

`web/src/app/page.tsx`'s zero-results branch already rendered an
`EmptyState` ("No companies match ..."). The new button sits directly
alongside it, inside the same conditional:

```tsx
companyResults.length === 0 ? (
  <div className="flex flex-col gap-2">
    <EmptyState message={`No companies match "${companyQuery}".`} />
    {!showCreateCompanyRequest && (
      <Button onClick={() => setShowCreateCompanyRequest(true)}>
        Want to file a create company request?
      </Button>
    )}
  </div>
) : ( /* results */ )
```

`showCreateCompanyRequest` starts `false` and is reset to `false` at
the top of every new search — so a candidate who opens the section,
then runs a different search that happens to also return zero results,
sees the button again rather than an already-open section left over
from the previous query. There's no other code path that can set this
state to `true`: no route, no nav link, no default. The only way in is
through a failed search plus one click on this specific button.

## Key concept: reusing the form, not duplicating it

The Name/Slug/Size/"Create company" form is character-for-character
the one that used to live in the wizard's no-context state before
issue #358 removed it — same fields, same validation pattern
(`pattern="[a-z0-9]+(-[a-z0-9]+)*"` on the slug), same `GatedSection`
gate. Only the surrounding copy and the post-success destination
differ:

```tsx
<p className="text-sm text-gray-500">
  Your search didn&apos;t find &quot;{companyQuery}&quot; — add it below so
  you can write a review for it. This creates the company itself,
  not a review.
</p>
```

versus the wizard's old, more generic "Write a review" framing. The
distinction matters: this form's job is adding a company record, a
one-time administrative act, not the review itself — the copy says so
explicitly rather than implying the two are the same action.

## Key concept: success redirects into the exact same handoff every other link uses

```ts
async function handleCreateCompanyRequest(formData: FormData) {
  const created = await api.createCompany({ ... });
  router.push(
    `/write-review?companyId=${created.id}&companySlug=${created.slug}&companyName=${encodeURIComponent(created.name)}`,
  );
}
```

This is the identical query-param shape `CompanyResultRow`'s "Write a
review" link and the company profile page's link already use — no
special-casing needed on `/write-review`'s side for "a company that
was *just* created" versus "an existing company a candidate picked."
The wizard's existing company-handoff effect (issue #358) treats both
identically: no matching draft exists yet, so it starts a fresh one.

## Step-by-step: what actually got built and verified

1. `web/src/app/page.tsx` gained `showCreateCompanyRequest` and
   `candidateSession` state, a "Want to file a create company request?"
   button inside the zero-results empty state, and a new "Request a new
   company" section (gated with `GatedSection`) containing the reused
   form.
2. `handleCompanySearch` resets `showCreateCompanyRequest` to `false`
   at the start of every new search.
3. `handleCreateCompanyRequest` creates the company via the existing
   `api.createCompany()` client method, then `router.push()`s into
   `/write-review` with the new company's id/slug/name.
4. 4 new `page.spec.tsx` tests: the section never appears on page load;
   it appears only after a zero-result search plus a click on its own
   button; an anonymous visitor sees `GatedSection`'s login prompt
   instead of the form; a logged-in candidate's successful creation
   redirects to the correct `/write-review` URL — 143 web tests total,
   build and lint clean.
5. Live-verified with a real headless browser (Playwright) against the
   real `kind` cluster: searched for a nonexistent company, confirmed
   the section wasn't shown pre-emptively, revealed it via the button,
   confirmed an anonymous visitor sees the login gate and not the form,
   logged in via a real magic link, created the company, and confirmed
   the redirect landed on `/write-review` with the URL stripped and the
   draft auto-started for the new company — zero console errors. The
   test company was cleaned up directly (`kubectl exec` psql delete)
   with its now-orphaned OpenSearch document removed via the existing
   `prune-orphaned-company-search-docs` script (D51), confirmed via a
   dry run first.

## What this enabled

Adding a genuinely new company is still possible — but only surfaces
at the one moment it's actually needed (a proven-empty search), with
copy that describes what's actually happening instead of borrowing the
wizard's "write a review" framing for what is really an
administrative, one-time action.
