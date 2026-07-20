// OpenSearch has no per-database isolation the way Postgres does — indices
// are the only namespace. Now that local e2e runs share kind's single
// OpenSearch with the deployed app (docs/DECISIONS.md D26, the OpenSearch
// counterpart of D24's interview_insights_test database), a prefix is what
// keeps test documents out of the indices real search results come from.
// Default is empty: CI and every deployed environment keep the bare
// `companies`/`reviews` names unchanged.
export function searchIndexName(base: string): string {
  return `${process.env.OPENSEARCH_INDEX_PREFIX ?? ''}${base}`;
}
