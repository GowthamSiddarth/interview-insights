import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { CompaniesService } from '../src/companies/companies.service';
import { CandidatesService } from '../src/candidates/candidates.service';
import { ModerationService } from '../src/moderation/moderation.service';
import { BulkProcessSubmissionService } from '../src/bulk-process-submission/bulk-process-submission.service';
import { RoundTypeFieldOptionsService } from '../src/round-type-registry/round-type-field-options.service';
import { CompanySearchService } from '../src/search/company-search.service';
import { runSeed, SeedServices } from '../scripts/seed-demo-data';

// GitHub issue #164 (Phase 19) — proves the generator's *output*, not its
// line-by-line logic (already covered by scripts/seed-demo-data.spec.ts's
// unit tests): a real run through runSeed() against real Postgres +
// OpenSearch produces companies that are approved and searchable (proving
// the real CompaniesService/ModerationService path ran, not a raw-Prisma
// bypass — the exact Phase 5 bug this issue's own design guards against),
// and rounds whose type_metadata validates against the real round-type
// registry (proving RoundTypeFieldOptionsService's real active options
// were used, not arbitrary faker strings).
describe('seed-demo-data (e2e)', () => {
  let moduleRef: TestingModule;
  let services: SeedServices;
  let companySearchService: CompanySearchService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    await moduleRef.init();

    services = {
      prisma: moduleRef.get(PrismaService),
      companiesService: moduleRef.get(CompaniesService),
      candidatesService: moduleRef.get(CandidatesService),
      moderationService: moduleRef.get(ModerationService),
      bulkSubmissionService: moduleRef.get(BulkProcessSubmissionService),
      roundTypeFieldOptionsService: moduleRef.get(RoundTypeFieldOptionsService),
    };
    companySearchService = moduleRef.get(CompanySearchService);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('generates approved, searchable companies and registry-valid rounds through the real write paths', async () => {
    const summary = await runSeed(services, 3);

    expect(summary.companies).toBe(3);
    expect(summary.companyIds).toHaveLength(3);
    expect(summary.processes).toBeGreaterThan(0);
    expect(summary.roundRatings + summary.recruiterRatings + summary.overallReviews).toBeGreaterThan(0);
    // A realistic moderation-outcome mix, not an always-fully-moderated
    // dataset — the kickoff brainstorm's scope addition beyond the
    // original review-count-only distribution requirement.
    expect(summary.approved).toBeGreaterThan(0);

    // Looked up by the exact ids runSeed() itself created — not a
    // createdAt-since-timestamp query, which would also match whatever
    // other e2e spec files are writing to this same shared test database
    // in parallel Jest workers at the same time.
    const createdCompanies = await services.prisma.company.findMany({
      where: { id: { in: summary.companyIds } },
    });
    expect(createdCompanies).toHaveLength(3);
    // Every company is approved — proving CompaniesService.create() +
    // ModerationService.approve() actually ran, not a raw insert that
    // skipped the Phase 35 moderation gate.
    expect(createdCompanies.every((c) => c.status === 'approved')).toBe(true);

    // Searchable via the real OpenSearch index — proving indexing happened
    // through the real approval path (D16/D17), not bypassed.
    for (const company of createdCompanies) {
      const results = await companySearchService.search(company.name);
      expect(results.some((r) => r.id === company.id)).toBe(true);
    }

    // Every generated round's type_metadata validates against the real
    // round-type registry — proving controlled-vocabulary values came
    // from the actual seeded/admin-managed options, not arbitrary faker
    // strings that would fail this exact check on the live write path.
    const processes = await services.prisma.interviewProcess.findMany({
      where: { companyId: { in: createdCompanies.map((c) => c.id) } },
      include: { rounds: true },
    });
    const rounds = processes.flatMap((p) => p.rounds);
    expect(rounds.length).toBeGreaterThan(0);
    for (const round of rounds) {
      await expect(
        services.roundTypeFieldOptionsService.validateTypeMetadata(
          round.roundType,
          (round.typeMetadata as Record<string, unknown> | null) ?? undefined,
        ),
      ).resolves.toBeUndefined();
    }
  });

  // GitHub issue #524 (Phase 41) — proves the real Moderator rows and the
  // real ModerationService.claim() path, not just the pure random-picking
  // logic scripts/seed-demo-data.spec.ts already unit-tests. Deterministic
  // (moderator count, claimedBy FK integrity) rather than asserting
  // summary.claimed > 0 outright — PENDING_CLAIM_RATE (30%) applied to the
  // ~10% of entities that land 'pending' out of this test's modest
  // 3-company run is too thin a sample to assert on without real flakiness.
  it('seeds real Moderator rows and claims pending entries only through ModerationService.claim()', async () => {
    const summary = await runSeed(services, 3);

    expect(summary.moderators).toBe(summary.moderatorIds.length);
    expect(summary.moderatorIds.length).toBeGreaterThan(0);

    const moderators = await services.prisma.moderator.findMany({
      where: { id: { in: summary.moderatorIds } },
    });
    expect(moderators).toHaveLength(summary.moderatorIds.length);

    expect(summary.claimed).toBeLessThanOrEqual(summary.pending);

    if (summary.claimed > 0) {
      const claimedEntries = await services.prisma.moderationQueueEntry.findMany({
        where: { claimedById: { in: summary.moderatorIds } },
      });
      expect(claimedEntries.length).toBeGreaterThanOrEqual(summary.claimed);
      // A claimed entry is claimed but not yet reviewed — claim() is a
      // "someone's on it" signal, not a resolution.
      for (const entry of claimedEntries) {
        expect(entry.reviewedAt).toBeNull();
      }
    }
  });
});
