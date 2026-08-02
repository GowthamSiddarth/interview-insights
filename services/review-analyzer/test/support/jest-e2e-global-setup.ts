// GitHub issue #340 — this service's PrismaService now connects to a real
// Postgres at e2e boot (D75/D81's own Prisma schema), same requirement
// notification-service's own global setup already established. Lighter
// than that one still: this service never writes anything (read-only in
// practice), so there's no table to truncate here — just the same guard
// against accidentally pointing at a non-test database.
export default function globalSetup(): void {
  const databaseUrl = process.env.DATABASE_URL ?? '';
  if (!databaseUrl.includes('test')) {
    throw new Error(
      'Refusing to run: DATABASE_URL does not look like a test database (must contain "test"). ' +
        'This service only reads, but it still must never connect to the dev database from a test run.',
    );
  }
}
