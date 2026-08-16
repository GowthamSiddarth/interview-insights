// GitHub issue #406 (Phase 37) — pulled out of seed-demo-data.ts so
// seed-demo-data-undo.ts's --list mode (enumerate manifests, no DB
// connection needed) can use parseStringArg() without also statically
// importing seed-demo-data.ts, which imports AppModule at module scope —
// AppModule's own decorator evaluation eagerly requires
// ADMIN_JWT_SECRET/ADMIN_PASSWORD_HASH/etc. to be set (AdminAuthModule),
// which --list has no reason to need. Kept deliberately free of any src/
// import beyond PrismaService (a thin PrismaClient wrapper with no further
// imports of its own — safe to load eagerly).
import { PrismaService } from '../src/prisma/prisma.service';

// GitHub issue #383/D61 originally guarded this (and its undo counterpart)
// against seeding/unseeding the wrong database by default, requiring an
// explicit --i-know-this-seeds-fake-data opt-in for anything but a
// dedicated interview_insights_test database. D96 retired that separate
// test database — there's only one local Postgres environment (dev) until
// real staging/prod infra exists (Phase 8b) — so this script now targets
// whatever DATABASE_URL points at with no confirmation flag required.
// Revisit once a real non-dev environment exists to guard against.
//
// GitHub issue #664 (Phase 46) — that revisit: the Hetzner pilot (D101/
// D103) is the first real, reachable non-dev environment this project has
// had since D96. overlays/hetzner-pilot's ConfigMap (#646) is the only
// overlay that sets DEPLOYMENT_ENV=hetzner-pilot; dev/staging/prod all
// leave it unset, so this stays a no-op everywhere except the pilot.
export function assertSeedingAllowed(): void {
  if (process.env.DEPLOYMENT_ENV === 'hetzner-pilot') {
    throw new Error(
      'Refusing to run: DEPLOYMENT_ENV=hetzner-pilot. seed-demo-data and ' +
        'seed-demo-data-undo write and delete data via real service calls and ' +
        'must never run against the pilot\'s real database.',
    );
  }
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
