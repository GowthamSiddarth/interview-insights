import { PrismaClient } from '@prisma/client';
import { GlobalAveragesService } from '../src/analytics/global-averages.service';
import type { PrismaService } from '../src/prisma/prisma.service';

const prisma = new PrismaClient();
// GlobalAveragesService only calls $queryRaw — a plain PrismaClient
// satisfies that without going through Nest's DI/module bootstrapping,
// same approach as aggregation-views.e2e-spec.ts.
const service = new GlobalAveragesService(prisma as unknown as PrismaService);

const unique = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

async function refresh(viewName: string) {
  await prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW ${viewName}`);
}

async function seedCompanyWithCodingRatings(
  difficulties: number[],
): Promise<void> {
  const company = await prisma.company.create({
    data: { name: 'Acme Corp', slug: `acme-${unique()}`, sizeBucket: 'mid' },
  });
  const candidate = await prisma.candidate.create({ data: { emailHash: `hash-${unique()}` } });
  const process = await prisma.interviewProcess.create({
    data: {
      companyId: company.id,
      candidateId: candidate.id,
      roleTitle: 'Senior Backend Engineer',
      outcome: 'in_progress',
    },
  });

  for (const [i, difficulty] of difficulties.entries()) {
    const round = await prisma.round.create({
      data: { processId: process.id, sequenceNumber: i + 1, title: `Round ${i + 1}`, roundType: 'coding' },
    });
    await prisma.roundRating.create({
      data: {
        roundId: round.id,
        candidateId: candidate.id,
        difficulty,
        fluency: difficulty,
        clarity: difficulty,
        focus: difficulty,
        status: 'approved',
      },
    });
  }
}

// Proves GlobalAveragesService's weighted-average SQL (docs/ROADMAP.md
// Phase 4 issue #8) against real seeded data spanning multiple companies —
// a unit test with mocked Prisma can't catch a wrong JOIN/GROUP BY. The
// null-for-no-data path is deliberately NOT covered here (it used to be,
// via a "find an unused RoundType" scan) — that scan's premise breaks
// permanently once every RoundType has real data somewhere in this shared
// e2e-suite database (e.g. seed-demo-data.e2e-spec.ts iterates
// Object.values(RoundType)), which is exactly what started happening.
// The null path is pure application logic with no JOIN/GROUP BY to get
// wrong, so it's already fully covered by
// global-averages.service.spec.ts's mocked-Prisma tests instead.
describe('GlobalAveragesService (e2e)', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('weights each company by its own sample_size, matching the true global average', async () => {
    // Company A: 2 ratings at difficulty=4 (sum=8, n=2)
    // Company B: 3 ratings at difficulty=2 (sum=6, n=3)
    // True global average: (8+6)/(2+3) = 2.8
    await seedCompanyWithCodingRatings([4, 4]);
    await seedCompanyWithCodingRatings([2, 2, 2]);

    await refresh('company_round_type_aggregates');

    const globalAverages = await service.getRoundTypeGlobalAverages('coding');

    expect(globalAverages).not.toBeNull();
    expect(globalAverages!.sampleSize).toBeGreaterThanOrEqual(5);
    // Recompute the expected value from the actual total sample size, since
    // this materialized view accumulates across every test run against the
    // same persistent Docker Postgres volume (see the fraud-checks e2e
    // fix — same lesson applies here).
    const rows = await prisma.$queryRaw<{ avg_difficulty: string; sample_size: number }[]>`
      SELECT
        SUM(avg_difficulty * sample_size) / NULLIF(SUM(sample_size), 0) AS avg_difficulty,
        SUM(sample_size)::int AS sample_size
      FROM company_round_type_aggregates
      WHERE round_type = 'coding'
    `;
    expect(globalAverages!.avgDifficulty).toBeCloseTo(Number(rows[0].avg_difficulty), 5);
    expect(globalAverages!.sampleSize).toBe(rows[0].sample_size);
  });
});
