import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaExceptionFilter } from '../src/common/prisma-exception.filter';
import { computeShrinkageScore } from '../src/analytics/shrinkage-score.util';

const prisma = new PrismaClient();
const unique = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

interface CompanyAnalyticsBody {
  companyId: string;
  roundTypes: {
    roundType: string;
    sampleSize: number;
    scores: Record<string, number | null>;
  }[];
  recruiter: { sampleSize: number; scores: Record<string, number | null> } | null;
  overall: { sampleSize: number; scores: Record<string, number | null> } | null;
}

function body<T>(res: request.Response): T {
  return res.body as T;
}

async function refresh(viewName: string) {
  await prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW ${viewName}`);
}

// Proves GET /companies/:companyId/analytics (docs/ROADMAP.md Phase 4 issue
// #9) actually wires issue #7's views and issue #8's shrinkage scoring
// together correctly, end to end through the real HTTP surface.
describe('Analytics (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new PrismaExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- getHttpServer()'s return type doesn't line up with supertest's App type
  const server = () => request(app.getHttpServer());

  // Seeded directly via Prisma (bypassing the API), so status must be set
  // explicitly to 'approved' — it defaults to 'pending' now (GitHub issue
  // #369, Phase 35), and the analytics endpoint 404s a non-approved company.
  async function seedCompany(): Promise<string> {
    const company = await prisma.company.create({
      data: { name: 'Acme Corp', slug: `acme-${unique()}`, sizeBucket: 'mid', status: 'approved' },
    });
    return company.id;
  }

  async function seedRoundRatings(
    companyId: string,
    roundType: 'coding' | 'behavioral',
    difficulties: number[],
  ): Promise<void> {
    const candidate = await prisma.candidate.create({ data: { emailHash: `hash-${unique()}` } });
    const process = await prisma.interviewProcess.create({
      data: {
        companyId,
        candidateId: candidate.id,
        roleTitle: 'Senior Backend Engineer',
        outcome: 'in_progress',
      },
    });
    for (const [i, difficulty] of difficulties.entries()) {
      const round = await prisma.round.create({
        data: { processId: process.id, sequenceNumber: i + 1, title: `Round ${i + 1}`, roundType },
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

  it('returns a correctly shrinkage-scored value for a round type at/above the sample floor', async () => {
    const companyId = await seedCompany();
    await seedRoundRatings(companyId, 'coding', [4, 4, 4]);
    await refresh('company_round_type_aggregates');

    const res = await server().get(`/companies/${companyId}/analytics`).expect(200);
    const analytics = body<CompanyAnalyticsBody>(res);

    expect(analytics.companyId).toBe(companyId);
    const codingRow = analytics.roundTypes.find((rt) => rt.roundType === 'coding');
    expect(codingRow).toBeDefined();
    expect(codingRow!.sampleSize).toBe(3);
    expect(codingRow!.scores.difficulty).not.toBeNull();

    // Recompute the expected value independently, the same way
    // GlobalAveragesService does, since the platform-wide average includes
    // whatever this and every prior run of this suite has seeded (same
    // lesson as the fraud-checks e2e fix — don't assume a clean DB).
    const globalRows = await prisma.$queryRaw<{ avg_difficulty: string }[]>`
      SELECT SUM(avg_difficulty * sample_size) / NULLIF(SUM(sample_size), 0) AS avg_difficulty
      FROM company_round_type_aggregates WHERE round_type = 'coding'
    `;
    const expected = computeShrinkageScore(3, 4, Number(globalRows[0].avg_difficulty));
    expect(codingRow!.scores.difficulty).toBeCloseTo(expected!, 5);
  });

  it('returns null scores but a real sample_size for a round type under the floor', async () => {
    const companyId = await seedCompany();
    await seedRoundRatings(companyId, 'behavioral', [5, 5]);
    await refresh('company_round_type_aggregates');

    const res = await server().get(`/companies/${companyId}/analytics`).expect(200);
    const analytics = body<CompanyAnalyticsBody>(res);

    const behavioralRow = analytics.roundTypes.find((rt) => rt.roundType === 'behavioral');
    expect(behavioralRow).toBeDefined();
    expect(behavioralRow!.sampleSize).toBe(2);
    expect(Object.values(behavioralRow!.scores)).toEqual([null, null, null, null]);
  });

  it('omits round types the company has no approved ratings for, and returns null recruiter/overall when nothing exists', async () => {
    const companyId = await seedCompany();

    const res = await server().get(`/companies/${companyId}/analytics`).expect(200);
    const analytics = body<CompanyAnalyticsBody>(res);

    expect(analytics.roundTypes).toEqual([]);
    expect(analytics.recruiter).toBeNull();
    expect(analytics.overall).toBeNull();
  });

  it('includes correctly shrinkage-scored recruiter and overall analytics when they exist', async () => {
    const companyId = await seedCompany();
    const candidate = await prisma.candidate.create({ data: { emailHash: `hash-${unique()}` } });
    const process = await prisma.interviewProcess.create({
      data: { companyId, candidateId: candidate.id, roleTitle: 'Engineer', outcome: 'offer' },
    });
    const recruiter = await prisma.recruiter.create({
      data: { companyId, internalIdentifierHash: `rec-${unique()}`, displayLabel: 'Recruiter A' },
    });
    const interaction = await prisma.recruiterInteraction.create({
      data: { processId: process.id, recruiterId: recruiter.id },
    });
    await prisma.recruiterRating.create({
      data: {
        recruiterInteractionId: interaction.id,
        candidateId: candidate.id,
        reachability: 5,
        responsiveness: 5,
        guidelinesShared: 5,
        status: 'approved',
      },
    });
    await prisma.overallReview.create({
      data: {
        processId: process.id,
        candidateId: candidate.id,
        overallExperience: 5,
        wouldRecommend: true,
        status: 'approved',
      },
    });
    await refresh('company_recruiter_aggregates');
    await refresh('company_overall_aggregates');

    const res = await server().get(`/companies/${companyId}/analytics`).expect(200);
    const analytics = body<CompanyAnalyticsBody>(res);

    expect(analytics.recruiter).not.toBeNull();
    expect(analytics.recruiter!.sampleSize).toBe(1);
    expect(analytics.overall).not.toBeNull();
    expect(analytics.overall!.sampleSize).toBe(1);
    // n=1 is under the floor — present, but every score still null.
    expect(Object.values(analytics.recruiter!.scores)).toEqual([null, null, null]);
    expect(Object.values(analytics.overall!.scores)).toEqual([null, null]);
  });

  it('returns 404 for a non-existent company and 400 for a malformed id', async () => {
    await server().get('/companies/123e4567-e89b-12d3-a456-426614174000/analytics').expect(404);
    await server().get('/companies/not-a-uuid/analytics').expect(400);
  });
});
