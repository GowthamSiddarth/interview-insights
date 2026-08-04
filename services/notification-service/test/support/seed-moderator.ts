import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';

// Same reasoning as seed-candidate.ts: api's own write path
// (AdminAuthService.onModuleInit()) is what really populates a moderator
// row in production — this stands in for it so the e2e spec doesn't need
// api itself running as part of this service's own CI job. Raw SQL, not
// `prisma.moderator.create()`: this service's own schema.prisma (D75)
// only models the columns it actually reads (id, email) — the real
// `moderators` table also has NOT NULL `username`/`password_hash` with
// no default, which this fixture has to satisfy but which this service's
// own runtime code never needs to know exist.
export async function seedModeratorWithEmail(prisma: PrismaClient, email: string): Promise<string> {
  const id = randomUUID();
  const fixtureUsername = `e2e-moderator-${randomUUID()}`;
  const fixturePasswordHash = 'not-a-real-hash'; // never read by this service
  await prisma.$executeRaw`INSERT INTO moderators (id, username, password_hash, email) VALUES (${id}::uuid, ${fixtureUsername}, ${fixturePasswordHash}, ${email})`;
  return id;
}
