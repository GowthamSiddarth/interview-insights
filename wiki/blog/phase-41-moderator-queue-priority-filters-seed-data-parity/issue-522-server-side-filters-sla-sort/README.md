# Phase 41, Issue #522 — Moderation Queue: Server-Side Filters + SLA-Urgency Sort

*Part of Phase 41 — Moderator Queue Priority, Filters & Seed-Data Parity.
See `docs/ROADMAP.md` Phase 41.*

## The gap this closed

Phase 41 was raised from a simple audit question: which backend features
actually have frontend consumption? Phase 36 added `slaDeadline` and
`claimedById` to every `ModerationQueueEntry` so breaches could be
detected and work could be claimed — but `ModerationService.listPending()`
(the method backing `GET /moderation/queue`) still sorted by
`createdAt: 'asc'` and took no parameters at all. Every moderator saw the
exact same FIFO list, with no way to see only their own claimed work, only
unclaimed entries, only one company, or only flagged (as opposed to plain
pending) entries. `ModerationController.search()` already accepted
`q`/`category`, but that's a different route entirely — OpenSearch-backed
free text, not filters on the queue itself.

The fix didn't need a schema migration. Both fields the new sort/filter
logic needed already existed on `ModerationQueueEntry` since Phase 36
(#486) — this was purely a service/DTO/controller change.

## Four filters, one new sort

`GET /moderation/queue` gained a `ModerationQueueQueryDto` with four
optional fields:

```ts
export class ModerationQueueQueryDto {
  @IsOptional() @IsIn(ENTITY_TYPES) entityType?: ModerationEntityType;
  @IsOptional() @IsUUID() companyId?: string;
  @IsOptional() @IsIn(CLAIM_STATES) claimState?: ModerationQueueClaimState;
  @IsOptional()
  @Transform(({ value }) => (Array.isArray(value) ? value : [value]))
  @IsIn(STATUSES, { each: true })
  status?: ModerationQueueStatus[];
}
```

`status` is the one with a small wrinkle: a querystring param can arrive
as a single string (`?status=pending`) or, if repeated
(`?status=pending&status=flagged`), as an array — Express's querystring
parser produces one or the other depending on how many times the key
shows up. The `@Transform` normalizes both shapes into an array up
front, so the service layer only ever deals with `ModerationQueueStatus[]`.

`claimState` deliberately carries no client-supplied moderator id. `mine`
is resolved by the controller from the authenticated caller, the same
pattern `claim()`/`release()` already used since Phase 36:

```ts
listPending(@Query() query: ModerationQueueQueryDto, @Req() req: Request) {
  const moderator = req.user as AdminSessionPayload;
  return this.moderationService.listPending({
    ...query,
    moderatorId: query.claimState === 'mine' ? moderator.id : undefined,
  });
}
```

Trusting a client-supplied moderator id here would let any authenticated
moderator query anyone else's claimed queue by id — a small but real
authorization gap the existing claim/release pattern already avoided, so
this filter followed suit rather than introducing a new precedent.

In the service, each filter maps onto a `Prisma.ModerationQueueEntryWhereInput`
field directly, and the sort itself is a one-line change:

```ts
orderBy: { slaDeadline: 'asc' } // was: { createdAt: 'asc' }
```

`status` narrows only when exactly one value is given — an empty array or
both values together is equivalent to no filter, since every unreviewed
entry is already exactly one of the two states (`flagReason` set or not).

## The one filter that needed a real join: `companyId`

`moderation_queue`'s entity reference is polymorphic, not a foreign key
(see `docs/DATA_MODEL.md`) — an entry only knows its `entityType` and
`entityId`, not which company that entity ultimately belongs to. Three of
the four entity types need a join up through their process to get there;
the fourth (`company`, for company-creation requests) is trivial, since
its own `entityId` *is* the company id already:

```ts
private async resolveEntityRefsForCompany(
  companyId: string,
  entityType?: ModerationEntityType,
): Promise<Array<{ entityType: ModerationEntityType; entityId: string }>> {
  const wantsType = (type: ModerationEntityType) => entityType === undefined || entityType === type;

  const [roundRatings, recruiterRatings, overallReviews] = await Promise.all([
    wantsType('round_rating')
      ? this.prisma.roundRating.findMany({ where: { round: { process: { companyId } } }, select: { id: true } })
      : Promise.resolve([]),
    wantsType('recruiter_rating')
      ? this.prisma.recruiterRating.findMany({ where: { recruiterInteraction: { process: { companyId } } }, select: { id: true } })
      : Promise.resolve([]),
    wantsType('overall_review')
      ? this.prisma.overallReview.findMany({ where: { process: { companyId } }, select: { id: true } })
      : Promise.resolve([]),
  ]);

  const refs = [
    ...roundRatings.map((r) => ({ entityType: 'round_rating' as const, entityId: r.id })),
    ...recruiterRatings.map((r) => ({ entityType: 'recruiter_rating' as const, entityId: r.id })),
    ...overallReviews.map((r) => ({ entityType: 'overall_review' as const, entityId: r.id })),
  ];
  if (wantsType('company')) refs.push({ entityType: 'company', entityId: companyId });
  return refs;
}
```

The resolved refs get OR'd into the main query's `where`. Two details
worth calling out:

- **Scoped to `entityType` when the caller already gave one.** If a
  request asks for `companyId` + `entityType: 'round_rating'`, there's no
  reason to also query `recruiterRating`/`overallReview` — their rows
  could never match `where.entityType` anyway, so `wantsType()` short-
  circuits those two queries to an immediate empty array instead of
  running them for nothing.
- **An empty refs list short-circuits the whole request** to `[]` without
  ever touching `moderation_queue` — an `OR: []` in Prisma matches
  nothing anyway, but skipping the query entirely avoids relying on that
  Prisma behavior and makes the empty-result case explicit and testable.
  This only happens for a non-`company` `entityType` with zero matches:
  `company`'s own ref is always a candidate (its `entityId` trivially
  equals `companyId`) unless `entityType` itself excludes it.

## Verification

Unit coverage split cleanly along the same lines as the code: a new
`moderation-queue-query.dto.spec.ts` for validation/normalization (every
valid enum value accepted, everything else rejected, the single-value-vs-
array `status` normalization proven both ways), and a `listPending >
filters` block in `moderation.service.spec.ts` covering every filter
individually plus the `companyId` + `entityType` scoping and short-circuit
cases against mocked Prisma calls.

The real join logic — actually resolving a company's round ratings across
a live schema — only gets proven against a real Postgres, so two
integration tests went into `moderation.e2e-spec.ts`: `entityType` +
`claimState` combined (claim one of two round ratings, confirm `mine` and
`unclaimed` each return the right one), and `companyId` (two companies
created independently, confirm the filter returns only the matching
one's rating). 482/482 API unit tests and 28/28 in the moderation e2e
file passed before merge.

No schema migration, no new decision record — this issue's whole scope
was reusing fields Phase 36 already put in place.
