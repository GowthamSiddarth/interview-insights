# Phase 57, Issue #825 — Company Search Silently Truncates to 10 Results

*Part of Phase 57 — Code Quality & Performance Hardening.
See `docs/ROADMAP.md` Phase 57.*

## The gap

`CompanySearchService.search()` never passed `size`/`from` to
OpenSearch at all — every query silently fell back to OpenSearch's own
implicit default of 10 hits, with no way for a caller to page further
or even know more results existed beyond the first ten. A broad query
("engineering," say) would look like it only ever matched ten
companies, with nothing in the response distinguishing "there really
are only ten" from "there are hundreds, you're only seeing the first
page."

## The fix: real, bounded query params, all the way through

```ts
// search-companies-query.dto.ts
export class SearchCompaniesQueryDto {
  @IsString()
  @IsNotEmpty()
  q!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  size?: number = 10;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  from?: number = 0;
}
```

`size` caps at 50 — a search endpoint returning an unbounded number of
hits per request is its own kind of resource-exhaustion risk, so the
cap exists even though nothing about OpenSearch itself requires one.
`@Type(() => Number)` matters here specifically because query-string
values arrive as strings by default — without it, `class-validator`'s
`@IsInt()` would reject every legitimately-numeric `?size=25` outright,
since the raw value is the string `"25"`, not the number `25`, before
`class-transformer` coerces it.

`CompanySearchController`/`CompanySearchService.search()` both widened
to accept and forward the two new params straight into the OpenSearch
request body, with the same `10`/`0` defaults preserved so an existing
caller that never sends either param keeps getting identical behavior
to before.

## Verification

DTO-level tests confirm the default values apply when neither param is
given, and that an out-of-range `size` (0, or above 50) is rejected.
Service-level tests assert the exact `size`/`from` values reach the
OpenSearch client call — both the default-when-omitted case and an
explicit-values case, confirming the plumbing actually reaches the
query, not just that the DTO parses correctly in isolation.
