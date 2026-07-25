# Phase 28, Issue #301 — Warning Candidates When Their Session Expires Mid-Draft

*Part of Phase 28 — Wizard UX Refinements. Epic #280 reopened for this
follow-on. See `docs/ROADMAP.md` Phase 28.*

## Where this came from

Not a bug report — a question. Explaining why the wizard's write path
isn't gated behind login (Phase 26's deliberate design: a draft is
pure client-side state until the one atomic submit) surfaced a real
gap in that same design: what happens if a candidate *is* logged in,
starts a draft, and their session dies before they finish?

## Key concept: a fixed-expiry session and a mount-time check don't mix

The candidate session JWT and its non-httpOnly hint cookie
(`candidate_logged_in`) both expire exactly 1 hour after login — no
sliding renewal. That's a perfectly reasonable session length on its
own. The problem was how the wizard read it:
`candidateSession` — the state driving the review screen's
`GatedSection` around Submit — was set **once**, in a mount-time
`useEffect`. A candidate filling out a real multi-round interview
review (several rounds, recruiter touchpoints, an overall review) can
easily spend over an hour on it. Their session dies silently
server-side, but the page's in-memory belief that they're logged in
never updates — so the Submit button stays visibly available long
after it would actually fail.

## Key concept: poll instead of push, because there's nothing to push

There's no server-initiated way to tell the browser "your session just
expired" — no websocket, no SSE, nothing listening. But the check
itself is nearly free: `hasCandidateSessionHint()` is a synchronous
`document.cookie` read, not a network call. So the fix is a plain
30-second `setInterval` re-running that same check, comparing against
the previous known state:

```ts
setCandidateSession((prev) => {
  if (prev === true && !hasSession) setSessionExpiredWarning(true);
  else if (hasSession) setSessionExpiredWarning(false);
  return hasSession;
});
```

Tracking the *transition* (was true, now false) rather than just the
current value matters: a candidate who was never logged in should
never see a "your session expired" message — there was no session to
expire — and a candidate who logs back in (in another tab, say) should
have the warning clear again once the next poll notices.

## Key concept: the fix for the review screen was almost free

`GatedSection` — the component behind the Submit button — was already
driven by `candidateSession`. Making that state live was enough on its
own to make Submit correctly re-hide behind a login prompt the moment
expiry is detected; no separate change was needed there. The genuinely
new piece was a *proactive* warning banner shown across every step of
the draft (not just the review screen) the instant expiry is noticed,
so a candidate finds out before they even reach Submit — plus a
defense-in-depth path for the reactive case: if a submit somehow still
reaches the network with a now-invalid session (a timing gap between
polls), catching `status === 401` specifically shows the same clear
message instead of the generic validation-error fallback issue #281
built, which had no idea what a 401 meant and would have shown a
confusing "check the highlighted fields" message for something that
had nothing to do with the fields at all.

## What this enabled

A candidate's draft is never at risk from any of this — it's
`localStorage`-backed and untouched regardless of session state — but
now they find out *while they're still working* that they'll need to
log back in before they can submit, rather than discovering it only
after clicking Submit and getting a message that didn't explain what
actually went wrong.
