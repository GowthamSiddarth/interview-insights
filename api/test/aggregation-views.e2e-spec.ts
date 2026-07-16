import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface RoundTypeAggregateRow {
  company_id: string;
  round_type: string;
  avg_difficulty: string;
  sample_size: number;
}
interface RecruiterAggregateRow {
  company_id: string;
  avg_approachability: string;
  sample_size: number;
}
interface OverallAggregateRow {
  company_id: string;
  avg_overall_experience: string;
  pct_would_recommend: string;
  sample_size: number;
}

const unique = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

// Proves the materialized views from docs/ROADMAP.md Phase 4 issue #7
// compute correctly directly against Postgres — no HTTP surface exists yet
// (that's issue #9), so this talks to the DB layer directly rather than
// through the NestJS app.
describe('Aggregation materialized views (e2e)', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function refresh(viewName: string) {
    await prisma.$executeRawUnsafe(`REFRESH MATERIALIZED VIEW ${viewName}`);
  }

  it('company_round_type_aggregates only averages approved ratings', async () => {
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

    const rounds = await Promise.all(
      [1, 2, 3].map((sequenceNumber) =>
        prisma.round.create({
          data: {
            processId: process.id,
            sequenceNumber,
            title: `Round ${sequenceNumber}`,
            roundType: 'coding',
          },
        }),
      ),
    );

    const ratingData = (roundId: string, difficulty: number, status: 'approved' | 'pending') => ({
      roundId,
      candidateId: candidate.id,
      difficulty,
      fairness: difficulty,
      communicationFluency: difficulty,
      attentiveness: difficulty,
      biasSignal: difficulty,
      status,
    });
    // Only the first two (approved) should count — avg_difficulty = (4+2)/2 = 3.00.
    await prisma.roundRating.create({ data: ratingData(rounds[0].id, 4, 'approved') });
    await prisma.roundRating.create({ data: ratingData(rounds[1].id, 2, 'approved') });
    await prisma.roundRating.create({ data: ratingData(rounds[2].id, 5, 'pending') });

    await refresh('company_round_type_aggregates');

    const rows = await prisma.$queryRaw<RoundTypeAggregateRow[]>`
      SELECT company_id, round_type, avg_difficulty, sample_size
      FROM company_round_type_aggregates
      WHERE company_id = ${company.id}::uuid AND round_type = 'coding'
    `;

    expect(rows).toHaveLength(1);
    expect(rows[0].sample_size).toBe(2);
    expect(Number(rows[0].avg_difficulty)).toBe(3.0);
  });

  it('a company/round_type with zero approved ratings has no row at all', async () => {
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
    const round = await prisma.round.create({
      data: { processId: process.id, sequenceNumber: 1, title: 'Round 1', roundType: 'behavioral' },
    });
    await prisma.roundRating.create({
      data: {
        roundId: round.id,
        candidateId: candidate.id,
        difficulty: 3,
        fairness: 3,
        communicationFluency: 3,
        attentiveness: 3,
        biasSignal: 3,
        status: 'rejected',
      },
    });

    await refresh('company_round_type_aggregates');

    const rows = await prisma.$queryRaw<RoundTypeAggregateRow[]>`
      SELECT company_id FROM company_round_type_aggregates
      WHERE company_id = ${company.id}::uuid AND round_type = 'behavioral'
    `;
    expect(rows).toHaveLength(0);
  });

  it('company_recruiter_aggregates only averages approved recruiter ratings', async () => {
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
    const recruiter = await prisma.recruiter.create({
      data: { companyId: company.id, internalIdentifierHash: `rec-${unique()}`, displayLabel: 'Recruiter A' },
    });
    const interaction = await prisma.recruiterInteraction.create({
      data: { processId: process.id, recruiterId: recruiter.id },
    });
    await prisma.recruiterRating.create({
      data: {
        recruiterInteractionId: interaction.id,
        candidateId: candidate.id,
        approachability: 5,
        responseTime: 5,
        timeliness: 5,
        communicationQuality: 5,
        status: 'approved',
      },
    });

    await refresh('company_recruiter_aggregates');

    const rows = await prisma.$queryRaw<RecruiterAggregateRow[]>`
      SELECT company_id, avg_approachability, sample_size
      FROM company_recruiter_aggregates
      WHERE company_id = ${company.id}::uuid
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0].sample_size).toBe(1);
    expect(Number(rows[0].avg_approachability)).toBe(5.0);
  });

  it('company_overall_aggregates computes pct_would_recommend as a 0-100 percentage', async () => {
    const company = await prisma.company.create({
      data: { name: 'Acme Corp', slug: `acme-${unique()}`, sizeBucket: 'mid' },
    });
    const candidateA = await prisma.candidate.create({ data: { emailHash: `hash-${unique()}-a` } });
    const candidateB = await prisma.candidate.create({ data: { emailHash: `hash-${unique()}-b` } });
    const processA = await prisma.interviewProcess.create({
      data: { companyId: company.id, candidateId: candidateA.id, roleTitle: 'Engineer', outcome: 'offer' },
    });
    const processB = await prisma.interviewProcess.create({
      data: { companyId: company.id, candidateId: candidateB.id, roleTitle: 'Engineer', outcome: 'rejected' },
    });
    await prisma.overallReview.create({
      data: {
        processId: processA.id,
        candidateId: candidateA.id,
        overallExperience: 5,
        wouldRecommend: true,
        status: 'approved',
      },
    });
    await prisma.overallReview.create({
      data: {
        processId: processB.id,
        candidateId: candidateB.id,
        overallExperience: 3,
        wouldRecommend: false,
        status: 'approved',
      },
    });

    await refresh('company_overall_aggregates');

    const rows = await prisma.$queryRaw<OverallAggregateRow[]>`
      SELECT company_id, avg_overall_experience, pct_would_recommend, sample_size
      FROM company_overall_aggregates
      WHERE company_id = ${company.id}::uuid
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0].sample_size).toBe(2);
    expect(Number(rows[0].avg_overall_experience)).toBe(4.0);
    expect(Number(rows[0].pct_would_recommend)).toBe(50.0);
  });
});
