// Guards api/test/golden-path.e2e-spec.ts against ever running against the
// persistent dev database — this is the concrete answer to "make it safe
// to run intermittently without double-checking by hand every time" (the
// 2026-07-24 dev-DB cleanup incident this smoke test exists to prevent a
// repeat of). D24 (docs/DECISIONS.md) establishes `interview_insights_test`
// as a fixed literal database name, not a pattern — checked here the same
// way. Deliberately scoped to this one spec, not retrofitted onto every
// other e2e file: those already follow the manual DATABASE_URL-override
// convention without incident, and this guard exists specifically because
// the golden-path spec is the one most likely to be run ad hoc, outside
// the routine `npm run test:e2e` flow.
const TEST_DATABASE_NAME = 'interview_insights_test';

export function assertUsingTestDatabase(): void {
  const databaseUrl = process.env.DATABASE_URL ?? '';
  if (!databaseUrl.includes(TEST_DATABASE_NAME)) {
    throw new Error(
      `Refusing to run the golden-path smoke test: DATABASE_URL does not ` +
        `point at the ${TEST_DATABASE_NAME} database. This test creates, ` +
        `moderates, and erases real data — it must never run against the ` +
        `dev database. Set DATABASE_URL to include "${TEST_DATABASE_NAME}" ` +
        `before running \`npm run smoke:e2e\`.`,
    );
  }
}
