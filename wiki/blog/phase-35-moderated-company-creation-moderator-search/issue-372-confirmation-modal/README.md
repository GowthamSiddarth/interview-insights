# Phase 35, Issue #372 — Confirmation Modal Replaces the Create-Company-Request Auto-Redirect

*Part of Phase 35 — Moderated Company Creation & Moderator Search. See
`docs/ROADMAP.md` Phase 35.*

## The gap this closed

Issue #360 (Phase 34) built the search-failure "request a new company"
flow: fill out a form, submit, and get redirected straight into
`/write-review?companyId=...` to start reviewing the company you just
added. That made sense when a successful creation meant the company
was immediately real and usable. Once issue #369 shipped, it stopped
being true — a freshly created company is `status: pending`, invisible
everywhere, and not a valid target for a draft's eventual submission
until a moderator approves it. Redirecting into a wizard for a company
nobody (including the person who just requested it) can otherwise see
or select was no longer correct behavior. This issue is the direct
frontend follow-up.

## Key concept: an acknowledgment, not a decision

Every existing "are you sure" moment on this site (deleting a rating, a
draft, an account) uses a plain `window.confirm` — a yes/no decision
with two genuinely different outcomes. This moment isn't that: the
request has already been submitted by the time the confirmation shows;
there's nothing left to decide, only to acknowledge. That's why a
small custom `ConfirmationModal` component made more sense than
reaching for `window.confirm` again — its OK button and its corner ✕
both do the exact same thing, because there was never a second path to
choose between:

```tsx
export function ConfirmationModal({ title, message, onClose }: ConfirmationModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="confirmation-modal-title" ...>
        <h2 id="confirmation-modal-title">{title}</h2>
        <button onClick={onClose} aria-label="Close">✕</button>
        <p>{message}</p>
        <Button onClick={onClose}>OK</Button>
      </div>
    </div>
  );
}
```

This is the first genuinely custom modal component this project has
ever needed — everything before it either used the browser's own
`confirm()` or didn't need a modal at all.

## Key concept: dismissal returns the page to where it started

The acceptance criteria were specific about what happens after the
modal closes: the create-company-request section should collapse back
to just its trigger button, exactly as if the request had never been
opened. `handleCloseConfirmation` does both things at once —

```ts
function handleCloseConfirmation() {
  setConfirmationMessage(null);
  setShowCreateCompanyRequest(false);
}
```

— rather than leaving the filled-out form sitting there after a
successful, already-completed submission.

## A small cleanup this surfaced

Removing the redirect meant `useRouter()` had no remaining callers in
`web/src/app/page.tsx` at all — the import and the hook call were
removed entirely rather than left in place unused, matching this
project's own "don't leave dead code around" convention.

## Step-by-step: what actually got built and verified

1. New `web/src/components/ConfirmationModal.tsx`.
2. `handleCreateCompanyRequest` in `page.tsx` replaced its
   `router.push()` call with `setConfirmationMessage(...)`; a new
   `handleCloseConfirmation` resets both the modal and the
   create-company-request section's visibility.
3. 4 new tests in `confirmation-modal.spec.tsx` (renders title/message,
   OK calls `onClose`, the corner close calls `onClose`); the old
   redirect-assertion test in `page.spec.tsx` rewritten into three
   (shows the modal without navigating, OK dismisses and collapses the
   section, the corner close dismisses identically) — 154 web tests
   total, build/lint clean.
4. Live-verified against the real `kind` cluster with a real headless
   browser (Playwright): created a company request, confirmed the
   modal appeared and the URL never changed, clicked OK and confirmed
   both the modal and the request section were gone with the trigger
   button restored, and — on a second request — confirmed the corner ✕
   dismissed identically — zero console errors.

## What this enabled

The create-company-request flow's ending now honestly reflects what
just happened: a request was filed, not a company that's ready to
write a review for. Phase 35's frontend now correctly assumes nothing
about a company's usability until a moderator has actually approved
it, closing the loop issue #369 opened.
