# Phase 2.1 — API: Create + Read Endpoints

*Part of Phase 2 — Thin vertical slice. See `docs/ROADMAP.md` Phase 2,
`docs/DATA_MODEL.md`, `docs/DECISIONS.md` D2.*

## Why this came first

Phase 1 produced a schema and a scaffold, but no code had ever actually
written a row to the database yet. Phase 2's job was to prove the entire
core entity chain — `Company → InterviewProcess → Round → RoundRating` —
works end to end through real HTTP endpoints, with real validation and
real error handling, before any of the more interesting features
(moderation, analytics, search) had anything to build on.

## Key concepts

- **Scope the CRUD deliberately: Create + Read only, not full CRUD.**
  Update and Delete were explicitly deferred, for two concrete reasons:
  (1) there's no auth system yet to decide *who* is allowed to edit or
  delete a rating, and (2) allowing edits after submission undermines the
  moderation model itself — if a candidate could edit a rating after a
  moderator approved it, "approved" would stop meaning anything. This is a
  scope decision worth stating explicitly rather than an oversight; it's
  recorded in `CLAUDE.md`'s status log precisely so a later session
  doesn't "helpfully" add a `PATCH` endpoint without revisiting the
  reasoning.
- **Pseudonymous identity via a hashed email, not raw storage.**
  `docs/DATA_MODEL.md`'s first design principle — "anonymize identity, not
  accountability" — applies to candidates too, not just interviewers. The
  `candidates` table never stores a raw email, only `email_hash`.
- **Idempotent creation for the one identity users provide.** There's no
  login/session system yet, so a candidate typing the same email twice
  (e.g. returning to the wizard later) needs to resolve back to the *same*
  candidate row, not get a `409 Conflict` or a duplicate. Prisma's
  `upsert` makes this a one-line operation instead of a manual
  find-then-create dance.
- **A global exception filter beats duplicating error-mapping in every
  service.** Prisma throws its own typed errors (`P2002` unique violation,
  `P2003` foreign-key violation, `P2025` not-found) — translating those
  into the HTTP status codes callers actually expect (409, 422, 404)
  belongs in exactly one place, not copy-pasted into every controller
  method that might hit one.

## Core technologies

- **NestJS controllers/services/DTOs** — one module per entity
  (`companies`, `candidates`, `interview-processes`, `rounds`,
  `round-ratings`), each following the same three-file shape: a
  `*.controller.ts` (routing), a `*.service.ts` (business logic +
  Prisma calls), and a `dto/create-*.dto.ts` (input validation).
- **`class-validator` + `class-transformer`**, wired up globally via
  `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform:
  true })` in `main.ts` — every DTO's decorators (`@IsInt`, `@Min`, `@Max`,
  `@IsUUID`, `@IsEnum`, `@Matches`, ...) are enforced automatically on
  every incoming request body, and any field not declared on the DTO is
  rejected outright (`forbidNonWhitelisted`) rather than silently ignored.
- **Node's built-in `crypto` module** (`createHmac`) for email hashing —
  no external dependency needed for this.
- **A custom NestJS `ExceptionFilter`** (`PrismaExceptionFilter`),
  registered globally, catching `Prisma.PrismaClientKnownRequestError` and
  mapping its `code` field to the right `HttpException` subclass.

## System design approach

Every entity module follows an identical shape, which is itself a
deliberate design choice — once you understand one module
(`companies/companies.controller.ts`,
`companies/companies.service.ts`, `companies/dto/create-company.dto.ts`),
you understand all five, because they're structurally the same:

```
Controller  → thin, just routing + param parsing (ParseUUIDPipe for
               path params, @Body() DTO for request bodies)
Service     → all business logic + the actual PrismaClient calls
DTO         → class-validator decorators describing exactly what's
               a valid request body, nothing more
```

The **candidate email hash** deserves its own walk-through, since it's the
one piece of Phase 2 logic that isn't a simple Prisma passthrough:

```typescript
// candidates/email-hash.util.ts
export function hashEmail(email: string, secret: string): string {
  const normalized = email.trim().toLowerCase();
  return createHmac('sha256', secret).update(normalized).digest('hex');
}
```

Two details matter here beyond "hash the email":
- **HMAC, not a bare hash.** A bare SHA-256 hash of an email is still
  reversible via a rainbow table (emails aren't high-entropy secrets) —
  anyone with a list of common emails could precompute hashes and match
  them against the database. HMAC-ing with a server-side secret
  (`EMAIL_HASH_SECRET`, required at boot — the service throws if it's
  unset rather than silently hashing with an empty string) makes that
  attack infeasible without the secret.
- **Normalize before hashing.** `trim().toLowerCase()` ensures
  `Jane@Example.com` and `jane@example.com ` hash to the same value — the
  hash is meant to identify the same real person's return visits, not
  distinguish incidental capitalization/whitespace differences.

The **`CandidatesService.create()`** method ties this together with the
idempotency requirement:

```typescript
async create(dto: CreateCandidateDto) {
  const emailHash = hashEmail(dto.email, getEmailHashSecret());
  const candidate = await this.prisma.candidate.upsert({
    where: { emailHash },
    create: { emailHash },
    update: {},
  });
  return toResponse(candidate); // never includes emailHash or raw email
}
```

`upsert` with an empty `update: {}` means "create if this hash doesn't
exist yet, otherwise just return the existing row unchanged" — exactly
the idempotent-by-email behavior needed, in one Prisma call instead of a
manual `findUnique` → conditionally `create` race-prone dance. The
response is also filtered through a `toResponse()` helper that explicitly
allow-lists which fields go out (`id`, `verificationStatus`, `verifiedAt`,
`createdAt`) — `emailHash` never leaves the service layer, even by
accident from a future field added to the Prisma model.

## The exception filter, end to end

Three Prisma error codes map to three different HTTP statuses, and the
filter is where that mapping lives exactly once:

```typescript
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  private mapException(exception: Prisma.PrismaClientKnownRequestError) {
    switch (exception.code) {
      case 'P2002': // unique constraint violation
        return new ConflictException(/* ... */);       // 409
      case 'P2003': // foreign key violation
        return new UnprocessableEntityException(/* ... */); // 422
      case 'P2025': // record not found (e.g. findUniqueOrThrow)
        return new NotFoundException('Record not found.');  // 404
      default:
        throw exception; // anything else: let NestJS's default handler deal with it
    }
  }
}
```

This one filter is what turns "a candidate rates the same round twice"
(a `P2002` on the `@@unique([roundId, candidateId])` constraint from
Phase 1's schema) into a clean `409 Conflict` response, without a single
`try/catch` inside `RoundRatingsService`. It's also what turns "look up a
company by an ID that doesn't exist" (`findUniqueOrThrow` throwing
`P2025`) into a `404`, and "create a process referencing a candidate ID
that doesn't exist" (`P2003`) into a `422` — three completely different
failure modes across three different services, all handled by the same
~20 lines of code registered once in `main.ts` via `app.useGlobalFilters(
new PrismaExceptionFilter())`.

## Step-by-step: what actually got built

1. **Built the `candidates` module first**, since `interview_processes`
   depends on a `candidateId` and nothing else can be tested without one:
   `POST /candidates` (upsert by email hash, `200 OK` since it's not
   strictly a "create" — it can return an existing candidate),
   `GET /candidates/:id`.
2. **Built `companies`**: `POST /companies` (name/slug/industry/
   sizeBucket/logoUrl, slug validated with a regex —
   `^[a-z0-9]+(-[a-z0-9]+)*$` — matching the URL-safe format
   `docs/DATA_MODEL.md` expects), `GET /companies`, `GET /companies/:id`.
3. **Built `interview-processes`**, nested under a company
   (`POST /companies/:companyId/processes`,
   `GET /companies/:companyId/processes`, `GET /processes/:id`) — the
   nesting in the URL reflects the real ownership hierarchy from
   `docs/DATA_MODEL.md`.
4. **Built `rounds`**, nested under a process
   (`POST /processes/:processId/rounds`,
   `GET /processes/:processId/rounds`).
5. **Built `round-ratings`**, nested under a round
   (`POST /rounds/:roundId/ratings`, `GET /rounds/:roundId/ratings`) — the
   read endpoint filters `status = 'approved'` from day one (the schema's
   default `status = 'pending'` plus this filter is what makes "every new
   rating is invisible until moderated" true even before Phase 3's
   moderation queue exists to ever flip that status).
6. **Wrote a `class-validator` DTO for every `POST` body**, matching
   `docs/DATA_MODEL.md`'s CHECK constraints at the application layer too
   (`@Min(1) @Max(5)` on every 1–5 rating field) — this means invalid
   input gets a clean `400` from NestJS's `ValidationPipe` before it ever
   reaches Postgres's own CHECK constraint, which exists as the last line
   of defense, not the first.
7. **Registered `ValidationPipe` and `PrismaExceptionFilter` globally** in
   `main.ts`, alongside `app.enableCors()` (see the companion post on the
   frontend wizard for why this specific line mattered more than expected).
8. **Wrote `PrismaExceptionFilter`** once all five modules existed and it
   became clear the same three Prisma error codes needed handling in every
   one of them.

## What this enabled

Every later phase's write path builds directly on these same five
modules and this same filter, unchanged in shape: Phase 3's moderation
queue extends `RoundRatingsService.create()` with a transaction and a
fraud check, but the DTO, controller, and exception handling underneath
are untouched. Phase 5's company search adds an OpenSearch indexing call
inside `CompaniesService.create()`, again without touching the
controller or DTO. The "thin controller, DTO validates input, service
holds logic, one shared exception filter" shape established here is the
one piece of Phase 2 that every subsequent phase reused verbatim rather
than reinventing.
