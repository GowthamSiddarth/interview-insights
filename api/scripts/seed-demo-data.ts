// GitHub issue #164 (Phase 19) — a synthetic data generator for lower
// environments, walking the *real* application paths (CompaniesService +
// ModerationService, BulkProcessSubmissionService, RoundTypeFieldOptionsService)
// via an in-process NestJS application context rather than raw SQL/Prisma
// inserts. That distinction matters concretely: a Phase 5 seed script once
// bypassed CompaniesService.create()'s OpenSearch indexing by inserting
// directly via Prisma — going through the real services avoids repeating
// that class of bug, and it also means every generated round's
// type_metadata is validated by the exact same RoundTypeFieldOptionsService
// the live write path enforces.
//
// Deliberately not a raw HTTP script either — hundreds of synthetic
// candidates would each need a real magic-link email round-trip for no
// benefit (that flow already has its own real e2e coverage); calling
// CandidatesService's upsert-by-email logic directly is the same shortcut
// CandidateAuthService.requestLink() itself is built on.
//
// Usage:
//   DATABASE_URL=... npm run seed:demo-data -- --companies=8
//   DATABASE_URL=<not interview_insights_test> npm run seed:demo-data -- --companies=8 --i-know-this-seeds-fake-data
import { randomUUID } from 'crypto';
import { NestFactory } from '@nestjs/core';
import { faker } from '@faker-js/faker';
import * as bcrypt from 'bcryptjs';
import {
  CompanySizeBucket,
  ModerationEntityType,
  ModerationFlagReason,
  ProcessOutcome,
  RoundType,
} from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { CompaniesService } from '../src/companies/companies.service';
import { CandidatesService } from '../src/candidates/candidates.service';
import { ModerationService } from '../src/moderation/moderation.service';
import { BulkProcessSubmissionService } from '../src/bulk-process-submission/bulk-process-submission.service';
import {
  RoundTypeFieldOptionsService,
  RoundTypeSchemaWithOptions,
} from '../src/round-type-registry/round-type-field-options.service';
import { CreateBulkProcessDto } from '../src/bulk-process-submission/dto/create-bulk-process.dto';
import { CreateBulkRoundDto } from '../src/bulk-process-submission/dto/create-bulk-round.dto';
import { CreateBulkRecruiterInteractionDto } from '../src/bulk-process-submission/dto/create-bulk-recruiter-interaction.dto';
import { writeManifest } from './seed-manifest';

const SEEDER_LABEL = 'seed-demo-data';

// GitHub issue #406 (Phase 37) — moved to seed-cli-utils.ts so
// seed-demo-data-undo.ts's --list mode can use these without statically
// importing this file's own AppModule import (see that module's comment
// for why). Re-exported here so existing imports of these from
// './seed-demo-data' (e.g. scripts/seed-demo-data.spec.ts) keep working
// unchanged.
export {
  assertSeedTargetConfirmed,
  parseIntArg,
  parseStringArg,
  refreshMaterializedViews,
} from './seed-cli-utils';
import { assertSeedTargetConfirmed, parseIntArg, refreshMaterializedViews } from './seed-cli-utils';

export interface Summary {
  companies: number;
  processes: number;
  roundRatings: number;
  recruiterRatings: number;
  overallReviews: number;
  approved: number;
  pending: number;
  rejected: number;
  flagged: number;
  // GitHub issue #524 (Phase 41) — how many of the seeded Moderator rows
  // ended up claiming a still-pending entry via the real claim() path.
  // Always <= pending, usually well under it (PENDING_CLAIM_RATE).
  claimed: number;
  // The generated moderators' own count/ids — a handful of real Moderator
  // rows (see seedModerators()) so the moderation queue has something
  // realistic to claim against, distinct from the single env-upserted
  // admin row AdminAuthService.onModuleInit() maintains.
  moderators: number;
  moderatorIds: string[];
  // The generated companies' own ids — lets a caller (e.g. a real e2e
  // test) look up exactly what this run created directly, rather than a
  // createdAt-since-timestamp query that would also match whatever other
  // e2e spec files happen to be writing to the same shared test database
  // in parallel Jest workers at the same time.
  companyIds: string[];
  // The generated candidates' own ids — GitHub issue #406 (Phase 37):
  // seed-demo-data-undo.ts needs these to delete a run's content by
  // candidateId, the same anchor MeService.eraseMe() already uses for a
  // single candidate.
  candidateIds: string[];
}

// Deliberately uneven — some companies stay under the n=3 shrinkage floor
// (hard constraint #3), some sit right at/above it, some are well above it
// — so a fresh seed exercises the "not enough reviews yet" path on purpose
// rather than by accident.
export function pickProcessCount(): number {
  const r = Math.random();
  if (r < 0.3) return faker.number.int({ min: 1, max: 2 });
  if (r < 0.7) return faker.number.int({ min: 3, max: 5 });
  return faker.number.int({ min: 8, max: 15 });
}

type ModerationOutcome = 'approved' | 'pending' | 'rejected' | 'flagged';

// Mostly approved (populates the public aggregates a demo environment
// actually wants to show), with a deliberate minority left pending/
// rejected/flagged — so the moderation queue and /me-style status
// displays also have realistic non-empty demo data, not just an
// always-fully-moderated dataset.
export function pickModerationOutcome(): ModerationOutcome {
  const r = Math.random();
  if (r < 0.7) return 'approved';
  if (r < 0.8) return 'pending';
  if (r < 0.9) return 'rejected';
  return 'flagged';
}

// GitHub issue #524 (Phase 41) — previously hardcoded to 'manual_report'
// for every flagged entry, so the moderation queue's flagReason filter had
// nothing but one value to demo against. Picks across the full enum,
// including 'ai_triage_stalled' (D71's reconciliation-sweep-only reason) —
// this is synthetic demo data, not a claim about how any specific entry
// was actually triaged.
export function pickFlagReason(): ModerationFlagReason {
  return faker.helpers.arrayElement(Object.values(ModerationFlagReason));
}

// GitHub issue #524 (Phase 41) — "a handful" of real Moderator rows so
// claim()/release() and the "claimed by X" queue badge have something
// realistic to show in a demo environment, not just the single admin row
// AdminAuthService.onModuleInit() upserts from env vars. Raw prisma.create()
// rather than a service call: unlike CompaniesService/CandidatesService,
// there's no ModeratorsService in this codebase to go through — the admin
// row's own creation path is env-driven, not built for stamping out N
// synthetic accounts — and a Moderator row has no side effects (no search
// indexing, no domain events) for a service to protect against bypassing.
export const SEED_MODERATOR_COUNT = 4;

export async function seedModerators(
  prisma: PrismaService,
  count: number = SEED_MODERATOR_COUNT,
): Promise<string[]> {
  const moderatorIds: string[] = [];
  for (let i = 0; i < count; i++) {
    const passwordHash = await bcrypt.hash(faker.internet.password(), 10);
    const moderator = await prisma.moderator.create({
      data: {
        username: `seed-moderator-${faker.string.alphanumeric(8).toLowerCase()}`,
        email: faker.internet.email(),
        passwordHash,
      },
    });
    moderatorIds.push(moderator.id);
  }
  return moderatorIds;
}

export function buildTypeMetadata(
  roundType: RoundType,
  schema: RoundTypeSchemaWithOptions,
): Record<string, unknown> | undefined {
  const fields = schema[roundType].fields;
  const metadata: Record<string, unknown> = {};

  for (const field of fields) {
    if (field.kind === 'text') {
      if (Math.random() < 0.5) metadata[field.key] = faker.lorem.sentence();
      continue;
    }
    if (!field.options || field.options.length === 0) continue;
    if (field.kind === 'controlled-single') {
      metadata[field.key] = faker.helpers.arrayElement(field.options);
    } else {
      const count = faker.number.int({ min: 1, max: Math.min(3, field.options.length) });
      metadata[field.key] = faker.helpers.arrayElements(field.options, count);
    }
  }

  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function buildRoundRating() {
  return {
    difficulty: faker.number.int({ min: 1, max: 5 }),
    fluency: faker.number.int({ min: 1, max: 5 }),
    clarity: faker.number.int({ min: 1, max: 5 }),
    focus: faker.number.int({ min: 1, max: 5 }),
    technicalDepth: Math.random() < 0.6 ? faker.number.int({ min: 1, max: 5 }) : undefined,
    freeText: Math.random() < 0.6 ? faker.lorem.sentences(2) : undefined,
  };
}

function buildRecruiterRating() {
  return {
    reachability: faker.number.int({ min: 1, max: 5 }),
    responsiveness: faker.number.int({ min: 1, max: 5 }),
    guidelinesShared: faker.number.int({ min: 1, max: 5 }),
    rejectionMessageAuthenticity: Math.random() < 0.4 ? faker.number.int({ min: 1, max: 5 }) : undefined,
    freeText: Math.random() < 0.5 ? faker.lorem.sentence() : undefined,
  };
}

function buildOverallReview() {
  return {
    overallExperience: faker.number.int({ min: 1, max: 5 }),
    wouldRecommend: faker.datatype.boolean(),
    reviewText: Math.random() < 0.6 ? faker.lorem.sentences(2) : undefined,
  };
}

function buildProcessDto(
  roundTypes: RoundType[],
  schema: RoundTypeSchemaWithOptions,
): CreateBulkProcessDto {
  const roundCount = faker.number.int({ min: 1, max: 3 });
  const rounds: CreateBulkRoundDto[] = [];
  for (let i = 0; i < roundCount; i++) {
    const roundType = faker.helpers.arrayElement(roundTypes);
    rounds.push({
      sequenceNumber: i + 1,
      title: Math.random() < 0.7 ? `${faker.person.jobTitle()} Round` : undefined,
      description: Math.random() < 0.6 ? faker.lorem.sentences(2) : undefined,
      roundType,
      scheduledDurationMinutes: faker.helpers.arrayElement([30, 45, 60, 90]),
      typeMetadata: buildTypeMetadata(roundType, schema),
      rating: Math.random() < 0.85 ? buildRoundRating() : undefined,
    });
  }

  const recruiterCount = faker.number.int({ min: 0, max: 2 });
  const recruiterInteractions: CreateBulkRecruiterInteractionDto[] = [];
  for (let i = 0; i < recruiterCount; i++) {
    recruiterInteractions.push({
      recruiterIdentifier: faker.internet.email(),
      rating: Math.random() < 0.85 ? buildRecruiterRating() : undefined,
    });
  }

  return {
    roleTitle: faker.person.jobTitle(),
    level: Math.random() < 0.5 ? faker.helpers.arrayElement(['L3', 'L4', 'L5', 'Senior', 'Staff']) : undefined,
    department: Math.random() < 0.4 ? faker.commerce.department() : undefined,
    outcome: faker.helpers.arrayElement(Object.values(ProcessOutcome)),
    rounds,
    recruiterInteractions,
    overallReview: Math.random() < 0.8 ? buildOverallReview() : undefined,
  };
}

async function createApprovedCompany(
  companiesService: CompaniesService,
  moderationService: ModerationService,
  prisma: PrismaService,
) {
  const name = faker.company.name();
  const slug = `${faker.helpers.slugify(name).toLowerCase()}-${faker.string.alphanumeric(6)}`;
  const company = await companiesService.create({
    name,
    slug,
    industry: Math.random() < 0.7 ? faker.commerce.department() : undefined,
    sizeBucket: faker.helpers.arrayElement(Object.values(CompanySizeBucket)),
  });
  const entry = await prisma.moderationQueueEntry.findFirstOrThrow({
    where: { entityType: 'company', entityId: company.id, reviewedAt: null },
  });
  await moderationService.approve(entry.id, { reviewedBy: SEEDER_LABEL });
  return company;
}

// GitHub issue #524 (Phase 41) — how often a still-pending entry gets
// claimed (not resolved) by one of the seeded moderators, simulating
// someone having picked it up without having reviewed it yet.
export const PENDING_CLAIM_RATE = 0.3;

async function applyModerationOutcome(
  entityType: ModerationEntityType,
  entityId: string,
  moderationService: ModerationService,
  prisma: PrismaService,
  summary: Summary,
  moderatorIds: string[],
): Promise<void> {
  const outcome = pickModerationOutcome();
  summary[outcome]++;

  if (outcome === 'pending') {
    if (moderatorIds.length === 0 || Math.random() >= PENDING_CLAIM_RATE) return;
    const entry = await prisma.moderationQueueEntry.findFirst({
      where: { entityType, entityId, reviewedAt: null },
    });
    if (!entry) return; // shouldn't happen, but never crash a whole run over one entity
    await moderationService.claim(entry.id, faker.helpers.arrayElement(moderatorIds));
    summary.claimed++;
    return;
  }

  const entry = await prisma.moderationQueueEntry.findFirst({
    where: { entityType, entityId, reviewedAt: null },
  });
  if (!entry) return; // shouldn't happen, but never crash a whole run over one entity

  const dto = { reviewedBy: SEEDER_LABEL };
  if (outcome === 'approved') await moderationService.approve(entry.id, dto);
  else if (outcome === 'rejected') await moderationService.reject(entry.id, dto);
  else await moderationService.flag(entry.id, { ...dto, flagReason: pickFlagReason() });
}

async function moderateGeneratedEntities(
  processId: string,
  moderationService: ModerationService,
  prisma: PrismaService,
  summary: Summary,
  moderatorIds: string[],
): Promise<void> {
  const rounds = await prisma.round.findMany({ where: { processId }, include: { ratings: true } });
  for (const round of rounds) {
    for (const rating of round.ratings) {
      summary.roundRatings++;
      await applyModerationOutcome('round_rating', rating.id, moderationService, prisma, summary, moderatorIds);
    }
  }

  const interactions = await prisma.recruiterInteraction.findMany({
    where: { processId },
    include: { ratings: true },
  });
  for (const interaction of interactions) {
    for (const rating of interaction.ratings) {
      summary.recruiterRatings++;
      await applyModerationOutcome('recruiter_rating', rating.id, moderationService, prisma, summary, moderatorIds);
    }
  }

  const overallReview = await prisma.overallReview.findUnique({ where: { processId } });
  if (overallReview) {
    summary.overallReviews++;
    await applyModerationOutcome('overall_review', overallReview.id, moderationService, prisma, summary, moderatorIds);
  }
}

// Exported so a real e2e test (test/seed-demo-data.e2e-spec.ts) can drive
// this exact logic against a real Postgres/OpenSearch through a
// Test.createTestingModule()-compiled AppModule, without shelling out to
// `ts-node` as a subprocess — matching how every other e2e spec in this
// project already gets a real, fully-wired app.
export interface SeedServices {
  prisma: PrismaService;
  companiesService: CompaniesService;
  candidatesService: CandidatesService;
  moderationService: ModerationService;
  bulkSubmissionService: BulkProcessSubmissionService;
  roundTypeFieldOptionsService: RoundTypeFieldOptionsService;
}

export async function runSeed(services: SeedServices, companyCount: number): Promise<Summary> {
  const {
    prisma,
    companiesService,
    candidatesService,
    moderationService,
    bulkSubmissionService,
    roundTypeFieldOptionsService,
  } = services;

  const schema = await roundTypeFieldOptionsService.getFullSchemaWithOptions();
  const roundTypes = Object.values(RoundType);
  const moderatorIds = await seedModerators(prisma);

  const summary: Summary = {
    companies: 0,
    processes: 0,
    roundRatings: 0,
    recruiterRatings: 0,
    overallReviews: 0,
    approved: 0,
    pending: 0,
    rejected: 0,
    flagged: 0,
    claimed: 0,
    moderators: moderatorIds.length,
    moderatorIds,
    companyIds: [],
    candidateIds: [],
  };

  for (let i = 0; i < companyCount; i++) {
    const company = await createApprovedCompany(companiesService, moderationService, prisma);
    summary.companies++;
    summary.companyIds.push(company.id);

    const processCount = pickProcessCount();
    for (let p = 0; p < processCount; p++) {
      const candidate = await candidatesService.create({ email: faker.internet.email() });
      summary.candidateIds.push(candidate.id);
      const dto = buildProcessDto(roundTypes, schema);
      const process = await bulkSubmissionService.create(company.id, candidate.id, dto);
      summary.processes++;
      await moderateGeneratedEntities(process.id, moderationService, prisma, summary, moderatorIds);
    }
  }

  await refreshMaterializedViews(prisma);
  return summary;
}

async function main(): Promise<void> {
  assertSeedTargetConfirmed();
  const companyCount = parseIntArg('--companies', 8);

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const services: SeedServices = {
      prisma: app.get(PrismaService),
      companiesService: app.get(CompaniesService),
      candidatesService: app.get(CandidatesService),
      moderationService: app.get(ModerationService),
      bulkSubmissionService: app.get(BulkProcessSubmissionService),
      roundTypeFieldOptionsService: app.get(RoundTypeFieldOptionsService),
    };
    const summary = await runSeed(services, companyCount);

    // GitHub issue #406 (Phase 37) — runId generation and manifest writing
    // deliberately live here, not inside runSeed(), so runSeed() stays
    // side-effect-free: test/seed-demo-data.e2e-spec.ts calls runSeed()
    // directly and shouldn't also write a manifest file on every test run.
    const runId = randomUUID();
    writeManifest({
      runId,
      createdAt: new Date().toISOString(),
      companyCount,
      companyIds: summary.companyIds,
      candidateIds: summary.candidateIds,
    });

    console.log(JSON.stringify({ runId, ...summary }, null, 2));
  } finally {
    await app.close();
  }
}

// Guards against main() running on import — test/seed-demo-data.e2e-spec.ts
// imports runSeed() directly without wanting a second CLI run to fire.
if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
