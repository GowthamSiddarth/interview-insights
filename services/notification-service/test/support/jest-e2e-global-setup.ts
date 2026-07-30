// Lighter version of api/test/support/jest-e2e-global-setup.ts's isolation
// guard (docs/DECISIONS.md D61/D65) — this service only ever touches
// `notification_log` (its own table) and inserts its own uniquely-`id`'d
// candidate fixtures, so there's no shared-state risk on par with api's
// full-database truncation. Still refuses to run against anything that
// doesn't look like a test database, same guiding principle.
import { PrismaClient } from '@prisma/client';

export default async function globalSetup(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL ?? '';
  if (!databaseUrl.includes('test')) {
    throw new Error(
      'Refusing to run: DATABASE_URL does not look like a test database (must contain "test"). ' +
        'These tests write real rows — they must never run against the dev database.',
    );
  }

  const prisma = new PrismaClient();
  try {
    await prisma.$executeRawUnsafe('DELETE FROM "notification_log";');
  } finally {
    await prisma.$disconnect();
  }
}
