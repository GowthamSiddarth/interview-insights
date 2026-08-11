# Phase 42, Issue #591 — Frontend: Role-Aware Admin Panel + Staff Account Management UI

*Part of Phase 42 — Staff Role Hierarchy & Admin/Moderator Tooling.
See `docs/ROADMAP.md` Phase 42 and `docs/DECISIONS.md` D99.*

## The gap this closed

Every backend piece of the role hierarchy existed by the time this issue
started — permissions, guards, staff-account endpoints — but the web app
had no idea any of it did. `AdminSession` didn't even carry a `role`
field, the moderation queue UI rendered every action button
unconditionally regardless of who was looking at it, and there was no
UI at all for the account-management endpoints #589 had just built.
This issue made the frontend match what the backend had already been
enforcing since #588: hide what a `staff` session can't do, and give
`admin` accounts somewhere to actually manage other accounts.

## Key concept: hiding an action client-side is UX, the backend guard is still the actual boundary

```tsx
const canAct = role !== 'staff';
return (
  <div className="flex flex-wrap items-center gap-2">
    {canAct && (
      <>
        <Button onClick={() => onAct('approve')}>Approve</Button>
        <Button onClick={() => onAct('reject')} variant="danger">Reject</Button>
        {/* ...flag, claim */}
      </>
    )}
    {entry.claimedBy !== null && (
      <>
        <ClaimBadge claimedBy={entry.claimedBy} isMine={isMine} />
        {isMine && canAct && <Button onClick={onRelease} variant="neutral">Release</Button>}
      </>
    )}
  </div>
);
```

`EntryActions` hides every write action for a `staff` session but keeps
rendering the claim badge — the badge is informational (who, if anyone,
currently owns this entry), not an action, so a `staff` account still
benefits from seeing it even though they can never claim anything
themselves. This gating is worth exactly what any client-side check is
worth: a nicer experience for someone who's supposed to be blocked, not
the actual security boundary. #588 already put the real boundary at the
route level (`PermissionsGuard` 403s a `staff` account's approve/reject/
flag/claim/release calls regardless of what the UI shows) — this issue
is purely about not showing someone a button that would just 403 if they
clicked it.

## Key concept: a read-only page is a smaller change than a second page

`round-type-options/page.tsx` already existed with full CRUD — D99 gives
`staff` read access to the round-type registry but no write permission
at all. Rather than building a separate read-only view, `FieldSection`
gained a `readOnly` prop that hides the Save/Retire/Add-value controls
and marks the remaining inputs `readOnly`/`disabled`:

```tsx
<FieldSection
  ...
  readOnly={role === 'staff'}
  onChanged={() => loadRows(roundType)}
  ...
/>
```

Same component, same data-loading logic, one boolean deciding which
controls render. The alternative — a second, staff-only page duplicating
the listing logic — would have meant two places that could drift out of
sync with each other and with the backend's own read-vs-write split;
this way there's exactly one source of truth for what the page shows,
and the branch is entirely about which buttons appear.

## Key concept: the one-time password UX gets reused, not reinvented

```tsx
function OneTimePassword({ username, password, onDismiss }) {
  return (
    <Card className="...">
      <p>Password for <span className="font-mono">{username}</span> — save this now, it will not be shown again:</p>
      <code>{password}</code>
      <Button onClick={onDismiss}>I&apos;ve saved it</Button>
    </Card>
  );
}
```

`/moderation/staff`'s create-account and reset-password flows both
funnel into this same component. Backend-side, #589 already established
"generate server-side, never persist, show exactly once" as the pattern
— the frontend's job was just not breaking that guarantee by, say,
storing the password in component state longer than necessary or
logging it anywhere. The banner is dismissed explicitly by the operator
clicking "I've saved it," not on a timer or on the next unrelated
action, so there's no risk of it disappearing before someone actually
copies it down.

## Key concept: fixing a pre-existing convention violation while already in the file

```tsx
// before
await api.adminLogin(username, password);
router.push('/moderation');

// after
await api.adminLogin(username, password);
window.location.href = '/moderation';
```

`web/CLAUDE.md` already required a hard navigation after any
session-changing action (login/logout/magic-link verify), specifically
because `NavBar` and this page's own session-state UI only check session
at mount and won't notice a client-side route change. The moderation
login page was the one place in the app that still used `router.push()`
for its own post-login redirect — a pre-existing gap this convention had
never caught, surfaced only because this issue was already touching
adjacent session-handling code. Fixed alongside the role-gating work
rather than filed as a separate follow-up, since the fix and the test
update it required (`window.location.href` needs the same jsdom-stub
mocking pattern `my-reviews-page.spec.tsx`/`verify-page.spec.tsx` already
use, not a `router.push` assertion) were small enough not to warrant
splitting out.

## Verification

New role-gating assertions in `moderation-page.spec.tsx` (a `staff`
session hides every action button but still shows the claim badge, and
never sees the "Staff accounts" link), and two new test files —
`staff-accounts-page.spec.tsx` (redirect for non-admin sessions, list/
create/deactivate/reset-password against a mocked API) and
`change-password-page.spec.tsx` (happy path, client-side confirmation
mismatch, wrong-current-password error without an incorrect redirect to
login). Every existing `/auth/admin/me` mock across the affected spec
files needed a `role` field added — TypeScript doesn't catch a mock
response missing a field the real endpoint now returns, only a test
actually exercising the role-dependent branch would, so this was found
by running the suite, not by the type checker. `npx tsc --noEmit`
clean (one pre-existing, unrelated `company-analytics-page.spec.tsx`
error confirmed present on `main` before this branch too), the full
187-test suite passing, `npm run lint` clean.
