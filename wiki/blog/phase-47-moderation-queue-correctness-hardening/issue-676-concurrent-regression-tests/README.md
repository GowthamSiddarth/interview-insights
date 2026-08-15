# Phase 47, Issue #676 — Real-Postgres Regression Coverage for Concurrent Moderation Actions

*Part of Phase 47 — Moderation Queue Correctness Hardening.
See `docs/ROADMAP.md` Phase 47, D104.*

## Why this needed its own issue

Issues #674 and #675 each shipped with mocked unit tests proving the fix
was internally consistent — but every one of those tests works by
hand-rolling a *stateful* mock of `moderationQueueEntry.updateMany` that
*assumes* Postgres-style row-level atomicity (gate check, mutate, return
a count) and then asserts `ModerationService`'s own logic behaves
correctly against that assumption. That's a meaningful test of the
service's code, but it can't actually prove the assumption itself holds
— that a real concurrent `UPDATE ... WHERE id = $1 AND reviewed_at IS
NULL` against a real Postgres table really does serialize two racing
transactions the way the mock pretends it does.

Phase 47's own planning called this out explicitly as its own issue
rather than folding more mocked tests into #674/#675: the real proof
needs two genuinely concurrent HTTP requests hitting the actual running
NestJS app, backed by the actual Postgres instance CI already spins up
for every e2e run.

## What got added

Two new tests in `api/test/moderation.e2e-spec.ts`, both using the same
shape: submit a rating, find its queue entry, log in as two *different*
moderator sessions (`loginAsSecondModerator`, already used elsewhere in
this file for claim/release authorization tests), then fire both
requests together via `Promise.all` and assert on the pair of HTTP status
codes rather than either request individually:

```ts
it('only one of two concurrent approve requests on the same entry succeeds', async () => {
  const { ratingId } = await submitRating();
  const entry = await findQueueEntryFor(ratingId);
  const second = await loginAsSecondModerator(app);

  const [first, secondRes] = await Promise.all([
    server().post(`/moderation/queue/${entry.id}/approve`).set('Cookie', adminCookie).send({}),
    server().post(`/moderation/queue/${entry.id}/approve`).set('Cookie', second.cookie).send({}),
  ]);

  const statuses = [first.status, secondRes.status].sort();
  expect(statuses).toEqual([201, 409]);
});
```

and the equivalent for `claim()`:

```ts
it('only one of two concurrent claim requests from different moderators succeeds', async () => {
  const { ratingId } = await submitRating();
  const entry = await findQueueEntryFor(ratingId);
  const second = await loginAsSecondModerator(app);

  const [first, secondRes] = await Promise.all([
    server().post(`/moderation/queue/${entry.id}/claim`).set('Cookie', adminCookie),
    server().post(`/moderation/queue/${entry.id}/claim`).set('Cookie', second.cookie),
  ]);

  const statuses = [first.status, secondRes.status].sort();
  expect(statuses).toEqual([201, 409]);
});
```

Firing both requests via a single `Promise.all` (rather than `await`ing
one before starting the other) is what actually creates the race:
Node dispatches both HTTP requests before either response comes back, so
the two `updateMany` calls really do land at the database around the
same time, with genuine competition for the row lock rather than the
test itself accidentally serializing them.

`[201, 409]` is the assertion, not `[201]` twice or an unconditional "the
first one always wins" — sorting the two statuses and comparing against
a fixed pair asserts *exactly one succeeded and exactly one lost the
race*, without caring (or being able to predict) which of the two
concurrent requests the database happens to process first.

## What this proves that the mocked tests couldn't

These two tests are the only place in the test suite where the
atomicity claim underlying #674 and #675's fixes is checked against a
real database instead of an assumption encoded into a mock. If the
`updateMany`-gated-on-`reviewedAt`/`claimedById` pattern turned out not
to actually serialize the way expected — a misunderstanding of Postgres's
isolation level, say, or a Prisma quirk in how `updateMany` compiles to
SQL — the mocked unit tests would keep passing (they only test the
service's own control flow) while these two would fail. They ran as part
of the same `api` CI job that spins up a real `postgres:16-alpine`
service container for every e2e run, so this coverage costs nothing
beyond the two new test cases themselves — no new CI infrastructure.

No production code changed for this issue — pure test addition, closing
out Phase 47's non-blog scope.
