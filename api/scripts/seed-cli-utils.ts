// GitHub issue #406 (Phase 37) — pulled out of seed-demo-data.ts so
// seed-demo-data-undo.ts's --list mode (enumerate manifests, no DB
// connection needed) can use assertSeedTargetConfirmed()/parseStringArg()
// without also statically importing seed-demo-data.ts, which imports
// AppModule at module scope — AppModule's own decorator evaluation
// eagerly requires ADMIN_JWT_SECRET/ADMIN_PASSWORD_HASH/etc. to be set
// (AdminAuthModule), which --list has no reason to need. Kept deliberately
// free of any src/ import beyond PrismaService (a thin PrismaClient
// wrapper with no further imports of its own — safe to load eagerly).
import { PrismaService } from '../src/prisma/prisma.service';

const TEST_DATABASE_NAME = 'interview_insights_test';

// GitHub issue #383/D61 found that an unguarded run against the wrong
// database silently contaminated the real dev Postgres and OpenSearch
// indices — this generator (and its undo counterpart) gets the identical
// class of guard from the start, not as an afterthought. Unlike the e2e
// suite's own assertLocalE2eIsolation() (which never allows an override —
// tests must always target the disposable database), this script's whole
// purpose includes seeding/unseeding a real dev/demo/staging database on
// purpose, so an explicit opt-in flag is allowed to override the default
// safety check.
export function assertSeedTargetConfirmed(): void {
  const databaseUrl = process.env.DATABASE_URL ?? '';
  if (databaseUrl.includes(TEST_DATABASE_NAME)) return;
  if (process.argv.includes('--i-know-this-seeds-fake-data')) return;
  throw new Error(
    `Refusing to seed: DATABASE_URL does not point at ${TEST_DATABASE_NAME}, ` +
      'and this run creates a large volume of fake data. If you really want ' +
      'to seed a different database on purpose (local kind dev, a future ' +
      'staging environment), pass --i-know-this-seeds-fake-data explicitly.',
  );
}

export function parseIntArg(flag: string, fallback: number): number {
  const arg = process.argv.find((a) => a.startsWith(`${flag}=`));
  if (!arg) return fallback;
  const value = Number(arg.split('=')[1]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

// Used by seed-demo-data-undo.ts's --run-id= flag.
export function parseStringArg(flag: string): string | undefined {
  const arg = process.argv.find((a) => a.startsWith(`${flag}=`));
  return arg ? arg.split('=').slice(1).join('=') : undefined;
}

// Shared by both scripts — a seed run refreshes these on the way in, an
// undo must refresh them again on the way out, or the three aggregates
// would keep reflecting rows that no longer exist.
export async function refreshMaterializedViews(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe('REFRESH MATERIALIZED VIEW company_round_type_aggregates');
  await prisma.$executeRawUnsafe('REFRESH MATERIALIZED VIEW company_recruiter_aggregates');
  await prisma.$executeRawUnsafe('REFRESH MATERIALIZED VIEW company_overall_aggregates');
}
