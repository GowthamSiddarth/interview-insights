# Phase 57, Issue #822 — GET /companies (findAll) Has No Pagination

*Part of Phase 57 — Code Quality & Performance Hardening.
See `docs/ROADMAP.md` Phase 57.*

## The gap

`CompaniesService.findAll()` ran an unbounded `findMany()` — every
approved company, every call, no `skip`/`take` at all. The sibling
`findTop()` (the landing page's quick-select grid) had already been
fixed for the identical problem after a live complaint (#415); `findAll()`
was the one endpoint still carrying the original unbounded-scan shape.

## The fix: real page/pageSize, paired with a real total count

```ts
async findAll(page = 1, pageSize = 200) {
  const where = { status: 'approved' } as const;
  const [items, total] = await Promise.all([
    this.prisma.company.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    this.prisma.company.count({ where }),
  ]);
  return { items, total, page, pageSize };
}
```

`pageSize` defaults to 200 — deliberately large, since the one real
consumer today (the moderation queue's company filter dropdown) expects
to see "effectively all of them" in a single call. A smaller default
would have silently broken that dropdown the moment the company count
crossed it. The response shape itself (`{items, total, page, pageSize}`)
matches the pagination envelope this codebase already uses elsewhere,
rather than inventing a new one for this endpoint specifically.

## Verification

Unit tests cover both the paginated call shape (`skip`/`take` computed
correctly for a non-default page/pageSize) and the no-args default
case. `web`'s moderation page (the one caller) and its own test suite
needed updating to unwrap `.items` from the new envelope instead of
treating the response as a bare array — caught immediately by `tsc`,
not silently, since the return type genuinely changed shape.
