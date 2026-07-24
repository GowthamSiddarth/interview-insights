// Shared by every index's onModuleInit (CompanySearchService, ReviewSearchService,
// ...): each always attempts index creation rather than check-then-act
// (indices.exists, then indices.create), which races when multiple app
// instances start concurrently (multiple test workers; multiple replicas
// in a real deployment) — see docs/DECISIONS.md D16. Swallowing the
// resulting resource_already_exists_exception is the idiomatic
// idempotent-create pattern instead.
export function isIndexAlreadyExistsError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null || !('body' in err)) return false;
  const body = (err as { body?: unknown }).body;
  if (typeof body !== 'object' || body === null || !('error' in body)) return false;
  const error = (body as { error?: unknown }).error;
  return (
    typeof error === 'object' &&
    error !== null &&
    'type' in error &&
    (error as { type?: unknown }).type === 'resource_already_exists_exception'
  );
}

// Used by ReviewSearchService.removeReview() (GitHub issue #150): deleting
// a rating that was never indexed (still pending/rejected/flagged at
// delete time) is expected, not an error — the opensearch client's
// ResponseError exposes the HTTP status directly as `.statusCode`.
export function isNotFoundError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'statusCode' in err && (err as { statusCode?: unknown }).statusCode === 404;
}
