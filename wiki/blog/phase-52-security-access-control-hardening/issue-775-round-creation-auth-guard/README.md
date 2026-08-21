# Phase 52, Issue #775 — No Auth Guard on Round Creation

*Part of Phase 52 — Security & Access-Control Hardening.
See `docs/ROADMAP.md` Phase 52, `docs/DECISIONS.md` D112.*

## The gap

`POST /processes/:processId/rounds` had no `@UseGuards` at all — no
session required, no ownership check, nothing. Anyone who knew (or
guessed) a `processId` could create a round with arbitrary
`title`/`description` free text under someone else's interview process.
Worse than the usual "wrong candidate's data" shape D31 already guarded
against elsewhere: `Round` isn't itself moderated content (`RoundRating`
is), so this free text would sit on a public process page attached to
another candidate's submission, unreviewed, forever.

D31 (the decision that authenticated every other write path) had
explicitly reasoned `Round` out of scope: it enumerated four
`candidateId`-bearing tables and stopped there, since `Round` has no
`candidateId` column of its own. True about the schema, incomplete as a
security analysis — ownership of a round lives one level up, on the
parent `InterviewProcess`, and nothing was checking it.

## The fix: walk up to the owning process

Same guard the app already had a name for
(`CandidateJwtAuthGuard`) plus an explicit ownership check against the
parent, mirroring how `InterviewProcessesService.remove()` already
reasons about ownership through a foreign key rather than a direct
column:

```ts
// rounds.controller.ts
@Post()
@UseGuards(CandidateJwtAuthGuard)
create(
  @Param('processId', ParseUUIDPipe) processId: string,
  @CurrentCandidateId() candidateId: string,
  @Body() dto: CreateRoundDto,
) {
  return this.roundsService.create(processId, candidateId, dto);
}
```

```ts
// rounds.service.ts — ownership checked before validation, so an
// unauthorized caller learns nothing about type_metadata rules either.
async create(processId: string, candidateId: string, dto: CreateRoundDto) {
  const process = await this.prisma.interviewProcess.findUniqueOrThrow({
    where: { id: processId },
    select: { candidateId: true },
  });
  if (process.candidateId !== candidateId) {
    throw new ForbiddenException('You can only add rounds to your own process.');
  }
  // ... validateTypeMetadata(), then create
}
```

`GET /processes/:processId/rounds` stays unguarded — reads were never
the problem, and every round is already effectively public once its
process exists.

Not a D31 reversal: D31's actual rule ("every `candidateId`-bearing
write requires a session, sourced only from the session") is untouched.
What changed is recognizing ownership can — and should — be checked
*transitively*, through a parent entity's `candidateId`, the same way
this app's own reads and deletes already do. `RecruiterInteraction`
creation (#776) had the identical gap and got the identical fix.

## Verification

`api/test/sessions-on-write-path.e2e-spec.ts` gained real-Postgres
cases: an unauthenticated request 401s, and an authenticated candidate
attempting to add a round to *another* candidate's process gets a 403,
not a 201. Every existing round-creation e2e call site across the suite
needed a session cookie added — a genuine ~20-file mechanical fix,
caught immediately by `tsc`/the test suite once the guard landed, not a
silent behavior change anyone could have missed.
