# Phase 57, Issue #828 — PATCH /companies/:id Requires the Full Payload

*Part of Phase 57 — Code Quality & Performance Hardening.
See `docs/ROADMAP.md` Phase 57.*

## The gap

`PATCH /companies/:id` reused `CreateCompanyDto` wholesale — whose core
fields (`name`, `slug`, `sizeBucket`) are required, because they're
genuinely required on *creation*. A candidate wanting to fix just their
company's `industry` field had to resend the entire payload, every
field, on every edit — a `PATCH` endpoint that couldn't actually do a
partial update.

## The fix: a real partial-update DTO

```ts
// GitHub issue #828 (Phase 57) — PATCH /companies/:id previously reused
// CreateCompanyDto, whose core fields (name/slug/sizeBucket) are
// required — a candidate fixing just `industry` had to resend all of
// them. Every field here is optional instead: Prisma's update() only
// ever writes the keys actually present on the DTO instance, so an
// omitted field here already left the existing column value untouched;
// the only thing blocking a true partial update was class-validator
// rejecting the request before it ever reached the service.
export class UpdateCompanyDto {
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsString() @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, { /* ... */ }) slug?: string;
  @IsOptional() @IsString() industry?: string;
  @IsOptional() @IsEnum(CompanySizeBucket) sizeBucket?: CompanySizeBucket;
  @IsOptional() @IsUrl() logoUrl?: string;
}
```

The comment's own framing is the real insight here: `Prisma.update()`
was never the blocker. It already only writes whatever keys are present
on the object it's given — an omitted field in a plain JS object simply
never reaches the `SET` clause. The *only* thing standing in the way of
a true partial update was `class-validator` rejecting the request
outright before it ever reached the service, because the DTO's fields
were marked required. Fixing this was purely a validation-layer change;
`CompaniesService.update()`'s own body needed no changes at all.

## Verification

DTO tests cover the actual point of the issue directly: a payload with
just `{ industry: 'fintech' }` validates cleanly (previously would have
failed on missing `name`/`slug`/`sizeBucket`), alongside the existing
malformed-slug/invalid-sizeBucket/empty-name rejection cases carried
over unchanged. A new e2e case sends a true single-field partial update
and confirms only that field changed — every other column on the
company row unaffected, proving the fix all the way through the real
HTTP path, not just at the DTO layer.
