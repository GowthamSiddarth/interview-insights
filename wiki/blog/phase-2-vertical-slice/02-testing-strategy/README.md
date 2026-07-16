# Phase 2.2 — Testing Strategy: Unit + Real-Postgres Integration

*Part of Phase 2 — Thin vertical slice. See `docs/ROADMAP.md` Phase 2/3,
`CLAUDE.md` conventions ("every new endpoint needs: unit test, integration
test, an OpenAPI/schema doc update").*

## Why this came first

Once Phase 2.1's five entity modules existed, the project needed a
testing shape that would scale to every phase after it — not just prove
this one vertical slice worked, but establish *the pattern* every future
endpoint would follow. That pattern, decided here and never revisited,
is the two-tier split this post covers: fast, isolated unit tests for
logic that doesn't need a database, and slower, real-Postgres
integration/e2e tests for anything that does.

## Key concepts

- **Two genuinely different failure modes need two genuinely different
  test styles.** A `class-validator` DTO rejecting `difficulty: 6` is a
  pure-function question — no database involved, should run in
  milliseconds. Whether a `POST /rounds/:roundId/ratings` followed by a
  second identical `POST` actually returns `409` depends on a real
  `UNIQUE` constraint firing in a real Postgres — no amount of mocking
  the Prisma client proves that constraint exists and works. Both
  questions are real and both need answering, but conflating them into
  one test suite either makes every test slow (mocking would defeat the
  purpose) or makes the suite fast but blind to real schema-level bugs.
- **"Mock the database" and "test the database" are not substitutes for
  each other.** Unit tests in this project mock `PrismaService` where a
  service's logic is being tested in isolation (e.g. does
  `CandidatesService.create()` call `hashEmail` with a lowercased,
  trimmed email?) — they never assert anything about what Postgres
  itself will actually do with that call.
- **Integration/e2e tests run against a real, Dockerized Postgres, not
  an in-memory or mocked one.** This is a direct, deliberate choice: an
  in-memory fake database can't reproduce a real `CHECK` constraint, a
  real `UNIQUE` violation's exact error code, or real foreign-key
  cascade behavior — and those are exactly the things Phase 1's schema
  work was careful to get right. Testing against anything other than the
  real engine would silently stop testing the parts of the schema that
  actually matter.
- **Every test that needs uniqueness generates its own unique data.**
  `uniqueSlug()` / `uniqueEmail()` helpers (timestamp + random suffix)
  appear in every e2e spec from this one onward — a fixed literal string
  like `'acme-corp'` would collide with a leftover row from a previous
  test run against the same persistent Postgres volume, and produce a
  flaky "unique constraint" failure that has nothing to do with the
  behavior actually being tested. This exact pattern (established here)
  is what later caught and fixed a real bug in the Phase 3 fraud-checks
  e2e suite, which had used fixed literal `free_text` strings.

## Core technologies

- **Jest** for both tiers, but with two separate configs: the default
  `jest` config runs `*.spec.ts` files colocated next to the code they
  test (e.g. `candidates/candidates.service.spec.ts`); a dedicated
  `test/jest-e2e.json` runs `*.e2e-spec.ts` files from `api/test/`
  against a real, running Postgres.
- **`ts-jest`** as the transform, so both configs run TypeScript directly
  without a separate compile step.
- **`supertest`**, driving real HTTP requests against a real, booted
  NestJS application (`Test.createTestingModule({ imports: [AppModule]
  }).compile()` then `app.init()`) — not calling service methods
  directly, but hitting the actual Express layer underneath, exercising
  the same `ValidationPipe`/`PrismaExceptionFilter` wiring `main.ts` sets
  up for the real running server.
- **The same Dockerized Postgres from Phase 1.3**, just pointed at by a
  different `DATABASE_URL` (a `_test` suffixed database, later mirrored
  in `.github/workflows/ci.yml`'s `postgres` service container) so local
  test runs never collide with local dev data.

## System design approach

The split maps directly onto NestJS's own layering from Phase 2.1:

| Layer | Test style | Example |
|---|---|---|
| DTO (`class-validator` decorators) | Unit — `validate()` from `class-validator` directly against a `plainToInstance`-built DTO, no NestJS app involved at all | `create-round-rating.dto.spec.ts` |
| Service (business logic + Prisma calls) | Unit — mock `PrismaService`, assert the service calls it correctly | `candidates.service.spec.ts` |
| Full request/response cycle (routing → validation → service → Prisma → real Postgres → exception filter → HTTP response) | Integration/e2e — real app, real database, real HTTP | `vertical-slice.e2e-spec.ts` |

The DTO tests are the cheapest and most numerous — every `1–5` rating
field gets an explicit boundary test (`0`, `6`, `-1` all rejected;
`1`/`5` accepted), because these are exactly the values most likely to
have an off-by-one bug (`@Min(1)` vs. accidentally writing `@Min(0)`).
From `round-ratings/dto/create-round-rating.dto.spec.ts`:

```typescript
it.each([0, 6, -1])('rejects difficulty out of 1-5 range: %i', async (difficulty) => {
  const dto = plainToInstance(CreateRoundRatingDto, { ...valid, difficulty });
  const errors = await validate(dto);
  expect(errors.some((e) => e.property === 'difficulty')).toBe(true);
});
```

The e2e test, by contrast, is intentionally narrow in count but wide in
what each test proves — one test drives the *entire* chain in one flow,
because that's the only way to prove the chain actually composes
correctly end to end, not just that each link works in isolation:

```typescript
it('drives the full slice: company -> process -> round -> rating', async () => {
  // ...creates a candidate, a company, a process, a round...
  const ratingRes = await server()
    .post(`/rounds/${roundId}/ratings`)
    .send({ candidateId, difficulty: 3, fairness: 4, /* ... */ })
    .expect(201);
  expect(body<RatingBody>(ratingRes).status).toBe('pending'); // D3

  // One rating per candidate per round — D8 — enforced by a real UNIQUE
  // constraint, not application logic:
  await server()
    .post(`/rounds/${roundId}/ratings`)
    .send({ candidateId, difficulty: 1, /* ... */ })
    .expect(409); // PrismaExceptionFilter mapping a real P2002

  // Public reads only ever surface approved ratings — this one is still
  // pending, so it stays invisible even though it was just created:
  const publicRatings = await server().get(`/rounds/${roundId}/ratings`).expect(200);
  expect(publicRatings.body).toEqual([]);
});
```

Three separate, real guarantees get proven in this one test: the schema's
default `status = 'pending'` (D3), the real `UNIQUE(round_id,
candidate_id)` constraint firing and getting correctly translated to
`409` by `PrismaExceptionFilter` (D8), and the read endpoint's
`status = 'approved'` filter actually hiding a rating that was just
created moments ago in the same test run. None of that is provable
against a mocked Prisma client — a mock would just return whatever the
test told it to return.

## Step-by-step: what actually got built

1. **Added a `*.spec.ts` next to every DTO**, testing every validation
   rule's boundary explicitly (valid payload, each required field
   missing, each ranged field out of bounds, malformed UUIDs).
2. **Added a `*.spec.ts` next to every service**, mocking `PrismaService`
   (a plain object with jest mock functions standing in for
   `prisma.candidate.upsert`, etc.) to test service-level logic in
   isolation — e.g. that `CandidatesService.create()` never leaks
   `emailHash` in its response, independent of whatever Postgres would
   actually do.
3. **Wrote `test/vertical-slice.e2e-spec.ts`** as one continuous flow:
   create a candidate idempotently by email (twice, assert same ID
   returned) → reject a malformed email → drive the full
   company → process → round → rating chain → assert the second
   duplicate rating conflicts → assert the pending rating stays
   invisible on the public read → separately assert an out-of-range
   rating is rejected with `400` and a nonexistent company lookup
   returns `404` (with a malformed UUID returning `400`, not `404` —
   testing that `ParseUUIDPipe` fails before the query even runs).
4. **Added a dedicated `test/jest-e2e.json`** config (`testRegex:
   ".e2e-spec.ts$"`, `ts-jest` transform) and a `test:e2e` npm script,
   kept fully separate from the default `test` script so a fast local
   `npm test` loop never has to wait on Postgres.
5. **Pointed `DATABASE_URL` at a `_test`-suffixed database** for e2e
   runs, so integration tests never touch the same schema local manual
   dev testing uses.
6. **Adopted the unique-per-test-run data pattern** (`uniqueSlug()`,
   `uniqueEmail()`) from the very first e2e spec, specifically because
   the Dockerized Postgres's data persists in a named volume across
   every test run — a fixed literal string would eventually collide.
7. **Wired the same Postgres service container into `.github/workflows/
   ci.yml`**'s `api` job, so CI runs the identical e2e suite against a
   fresh, disposable Postgres on every PR — the same tests, run in two
   environments (a developer's persistent local Docker volume, and CI's
   ephemeral one), which is exactly why the unique-data discipline from
   step 6 matters: it has to be correct in both.

## What this enabled

This two-tier pattern (colocated unit specs + a dedicated `test/*.e2e-
spec.ts` directory against real Postgres) is what every later phase's
`CLAUDE.md` convention entry ("every new endpoint needs: unit test,
integration test") actually means in practice, and it's followed
verbatim through every phase after this one — Phase 3's moderation queue
added `moderation.e2e-spec.ts` the same way; Phase 5's search added
`company-search.e2e-spec.ts` and `review-search.e2e-spec.ts` against a
real Postgres *and* a real OpenSearch, extending the same "test the real
engine, not a mock" principle to a second datastore. The unique-per-run
data discipline established here also directly prevented (and, in one
Phase 3 case, directly diagnosed) a whole class of flaky-test bugs in
every phase since.
