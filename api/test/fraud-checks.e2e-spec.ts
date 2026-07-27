import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { faker } from '@faker-js/faker';
import { AppModule } from '../src/app.module';
import { PrismaExceptionFilter } from '../src/common/prisma-exception.filter';
import { loginAsAdmin } from './support/admin-session';
import { loginAsCandidate } from './support/candidate-session';
import { createApprovedCompany } from './support/companies';

// GitHub issue #162 / D64: near-duplicate detection compares against every
// prior row ever written to the shared, persistent `interview_insights_test`
// database (D13's full-table-scan limitation, now trigram-based) — a fixed
// template string plus a short random numeric suffix (the old convention
// this file used pre-#162) stays well above the 0.55 similarity threshold
// against its own leftovers from a previous run, since only the small
// suffix differs. `faker.lorem.sentence()` gives each run's "must not be
// flagged" fixtures genuinely independent wording (real word-salad
// diversity, not just a different number), keeping cross-run collisions
// negligible in practice.
function uniqueFreeText(): string {
  return faker.lorem.sentence({ min: 10, max: 16 });
}

interface ProcessBody {
  id: string;
}
interface RoundBody {
  id: string;
}
interface RatingBody {
  id: string;
}
interface InteractionBody {
  id: string;
}
interface QueueEntryBody {
  entityId: string;
  flagReason: string | null;
}
interface QueueGroupBody {
  entries: QueueEntryBody[];
}

function body<T>(res: request.Response): T {
  return res.body as T;
}

// Proves the two checks from docs/ROADMAP.md Phase 3 issue #2 (extended by
// Phase 29 issue #317 / D52) actually flag suspicious writes — neither ever
// rejects the write outright (every rating still starts `pending`, CLAUDE.md
// hard constraint #2), they just attach a flagReason to the moderation_queue
// entry for a human reviewer.
describe('Fraud checks (e2e)', () => {
  let app: INestApplication;
  let adminCookie: string;

  // A fresh app per test — see overall-reviews.e2e-spec.ts's comment for
  // why a shared beforeAll instance is fragile once several tests each
  // need their own candidate login (this file stays under the 5-per-
  // window threshold today, but a fresh instance per test removes the
  // risk of a future added test tipping it over).
  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new PrismaExceptionFilter());
    app.use(cookieParser());
    await app.init();
    adminCookie = await loginAsAdmin(app);
  });

  afterEach(async () => {
    await app.close();
  });

  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- getHttpServer()'s return type doesn't line up with supertest's App type
  const server = () => request(app.getHttpServer());
  const uniqueSlug = () => `acme-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const uniqueEmail = () => `candidate-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;

  async function loginNewCandidate(): Promise<string> {
    const { cookie } = await loginAsCandidate(app, uniqueEmail());
    return cookie;
  }

  async function createProcess(candidateCookie: string): Promise<string> {
    const { id: companyId } = await createApprovedCompany(app, candidateCookie, {
      name: 'Acme Corp',
      slug: uniqueSlug(),
    });

    const processRes = await server()
      .post(`/companies/${companyId}/processes`)
      .set('Cookie', candidateCookie)
      .send({ roleTitle: 'Senior Backend Engineer', outcome: 'in_progress' })
      .expect(201);
    return body<ProcessBody>(processRes).id;
  }

  async function createRound(processId: string, sequenceNumber = 1): Promise<string> {
    const roundRes = await server()
      .post(`/processes/${processId}/rounds`)
      .send({ sequenceNumber, title: `Round ${sequenceNumber}`, roundType: 'coding' })
      .expect(201);
    return body<RoundBody>(roundRes).id;
  }

  async function queueEntryFor(entityId: string): Promise<QueueEntryBody> {
    const queueRes = await server().get('/moderation/queue').set('Cookie', adminCookie).expect(200);
    const entry = body<QueueGroupBody[]>(queueRes)
      .flatMap((g) => g.entries)
      .find((e) => e.entityId === entityId);
    if (!entry) throw new Error(`No moderation_queue entry found for entity ${entityId}`);
    return entry;
  }

  async function submitRoundRating(
    roundId: string,
    candidateCookie: string,
    freeText?: string,
  ): Promise<{ ratingId: string; queueEntry: QueueEntryBody }> {
    const ratingRes = await server()
      .post(`/rounds/${roundId}/ratings`)
      .set('Cookie', candidateCookie)
      .send({
        difficulty: 3,
        fluency: 5,
        clarity: 5,
        focus: 4,
        ...(freeText ? { freeText } : {}),
      })
      .expect(201);
    const ratingId = body<RatingBody>(ratingRes).id;
    return { ratingId, queueEntry: await queueEntryFor(ratingId) };
  }

  async function submitRecruiterRating(
    processId: string,
    candidateCookie: string,
    freeText?: string,
  ): Promise<{ ratingId: string; queueEntry: QueueEntryBody }> {
    const interactionRes = await server()
      .post(`/processes/${processId}/recruiter-interactions`)
      .send({ recruiterIdentifier: `recruiter-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com` })
      .expect(201);
    const interactionId = body<InteractionBody>(interactionRes).id;

    const ratingRes = await server()
      .post(`/recruiter-interactions/${interactionId}/ratings`)
      .set('Cookie', candidateCookie)
      .send({
        reachability: 4,
        responsiveness: 4,
        guidelinesShared: 4,
        ...(freeText ? { freeText } : {}),
      })
      .expect(201);
    const ratingId = body<RatingBody>(ratingRes).id;
    return { ratingId, queueEntry: await queueEntryFor(ratingId) };
  }

  async function submitOverallReview(
    processId: string,
    candidateCookie: string,
    reviewText?: string,
  ): Promise<{ reviewId: string; queueEntry: QueueEntryBody }> {
    const reviewRes = await server()
      .post(`/processes/${processId}/overall-review`)
      .set('Cookie', candidateCookie)
      .send({
        overallExperience: 4,
        wouldRecommend: true,
        ...(reviewText ? { reviewText } : {}),
      })
      .expect(201);
    const reviewId = body<RatingBody>(reviewRes).id;
    return { reviewId, queueEntry: await queueEntryFor(reviewId) };
  }

  // GitHub issue #317 / D52: the rate limit now counts submissions
  // (InterviewProcess creations), not individual entities.
  it('flags an entity with rate_limit once a candidate exceeds the submission threshold, but still creates it', async () => {
    const candidateCookie = await loginNewCandidate();
    // Threshold is 3 submissions (FraudChecksService.RATE_LIMIT_MAX_SUBMISSIONS)
    // — the 3rd submission's own content should trip it. Each process is
    // created immediately before its own rating is submitted, so the
    // submission count at each rating's creation time is 1, 2, then 3 —
    // not all 3 upfront, which would trip every rating equally.
    const process1 = await createProcess(candidateCookie);
    const round1 = await createRound(process1);
    const first = await submitRoundRating(round1, candidateCookie);

    const process2 = await createProcess(candidateCookie);
    const round2 = await createRound(process2);
    const second = await submitRoundRating(round2, candidateCookie);

    const process3 = await createProcess(candidateCookie);
    const round3 = await createRound(process3);
    const third = await submitRoundRating(round3, candidateCookie);

    expect(first.queueEntry.flagReason).toBeNull();
    expect(second.queueEntry.flagReason).toBeNull();
    expect(third.queueEntry.flagReason).toBe('rate_limit');
  }, 20000);

  // The exact false positive D52 fixed: a single legitimate submission with
  // several round ratings must never trip the rate limit against itself.
  it('never flags multiple round ratings within a single submission for rate_limit', async () => {
    const candidateCookie = await loginNewCandidate();
    const processId = await createProcess(candidateCookie);
    const round1 = await createRound(processId, 1);
    const round2 = await createRound(processId, 2);
    const round3 = await createRound(processId, 3);
    const round4 = await createRound(processId, 4);

    const first = await submitRoundRating(round1, candidateCookie);
    const second = await submitRoundRating(round2, candidateCookie);
    const third = await submitRoundRating(round3, candidateCookie);
    const fourth = await submitRoundRating(round4, candidateCookie);

    expect(first.queueEntry.flagReason).toBeNull();
    expect(second.queueEntry.flagReason).toBeNull();
    expect(third.queueEntry.flagReason).toBeNull();
    expect(fourth.queueEntry.flagReason).toBeNull();
  }, 20000);

  // GitHub issue #317: the submission-count rate limit applies identically
  // regardless of which entity type is being created within the
  // over-the-limit submission.
  it('applies the rate limit to recruiter ratings and overall reviews too, not just round ratings', async () => {
    const candidateCookie = await loginNewCandidate();

    const process1 = await createProcess(candidateCookie);
    const recruiterResult = await submitRecruiterRating(process1, candidateCookie);

    const process2 = await createProcess(candidateCookie);
    const overallResult1 = await submitOverallReview(process2, candidateCookie);

    // process3 is the candidate's 3rd submission — both a recruiter rating
    // and an overall review created within it should be flagged.
    const process3 = await createProcess(candidateCookie);
    const recruiterResult3 = await submitRecruiterRating(process3, candidateCookie);
    const overallResult3 = await submitOverallReview(process3, candidateCookie);

    expect(recruiterResult.queueEntry.flagReason).toBeNull();
    expect(overallResult1.queueEntry.flagReason).toBeNull();
    expect(recruiterResult3.queueEntry.flagReason).toBe('rate_limit');
    expect(overallResult3.queueEntry.flagReason).toBe('rate_limit');
  }, 20000);

  it('flags a round rating with duplicate when its free_text matches an existing round rating, but still creates it', async () => {
    const candidateCookieA = await loginNewCandidate();
    const candidateCookieB = await loginNewCandidate();
    const roundA = await createRound(await createProcess(candidateCookieA));
    const roundB = await createRound(await createProcess(candidateCookieB));

    const reviewText = uniqueFreeText();
    const first = await submitRoundRating(roundA, candidateCookieA, reviewText);
    // Same text, different case/whitespace, different candidate/round.
    const second = await submitRoundRating(roundB, candidateCookieB, `  ${reviewText.toUpperCase()}  `);

    expect(first.queueEntry.flagReason).toBeNull();
    expect(second.queueEntry.flagReason).toBe('duplicate');
  }, 20000);

  // GitHub issue #317: duplicate-text detection extends to recruiter
  // ratings and overall reviews, each scoped to its own field/entity type.
  it('flags a recruiter rating with duplicate when its free_text matches an existing recruiter rating', async () => {
    const candidateCookieA = await loginNewCandidate();
    const candidateCookieB = await loginNewCandidate();
    const processA = await createProcess(candidateCookieA);
    const processB = await createProcess(candidateCookieB);

    const freeText = uniqueFreeText();
    const first = await submitRecruiterRating(processA, candidateCookieA, freeText);
    const second = await submitRecruiterRating(processB, candidateCookieB, `  ${freeText.toUpperCase()}  `);

    expect(first.queueEntry.flagReason).toBeNull();
    expect(second.queueEntry.flagReason).toBe('duplicate');
  }, 20000);

  it('flags an overall review with duplicate when its review_text matches an existing overall review', async () => {
    const candidateCookieA = await loginNewCandidate();
    const candidateCookieB = await loginNewCandidate();
    const processA = await createProcess(candidateCookieA);
    const processB = await createProcess(candidateCookieB);

    const reviewText = uniqueFreeText();
    const first = await submitOverallReview(processA, candidateCookieA, reviewText);
    const second = await submitOverallReview(processB, candidateCookieB, `  ${reviewText.toUpperCase()}  `);

    expect(first.queueEntry.flagReason).toBeNull();
    expect(second.queueEntry.flagReason).toBe('duplicate');
  }, 20000);

  // Duplicate detection is scoped per entity type/field (GitHub issue
  // #317) — the same text appearing in a round rating's freeText must
  // never flag an overall review's reviewText as a duplicate of it.
  it('does not flag a duplicate across different entity types', async () => {
    const candidateCookieA = await loginNewCandidate();
    const candidateCookieB = await loginNewCandidate();
    const roundA = await createRound(await createProcess(candidateCookieA));
    const processB = await createProcess(candidateCookieB);

    const text = uniqueFreeText();
    const roundResult = await submitRoundRating(roundA, candidateCookieA, text);
    const overallResult = await submitOverallReview(processB, candidateCookieB, text);

    expect(roundResult.queueEntry.flagReason).toBeNull();
    expect(overallResult.queueEntry.flagReason).toBeNull();
  }, 20000);

  // GitHub issue #162 / D64: this is the whole point of the pg_trgm switch
  // — text that's genuinely reworded (not just a case/whitespace variant
  // of the exact same string, which every test above already covers) must
  // still trip the duplicate flag once its trigram similarity clears the
  // 0.55 threshold. Both variants wrap the *same* freshly-generated random
  // core phrase in different framing text — different wording throughout,
  // but sharing enough content to land above the threshold. The core is
  // regenerated per run (uniqueFreeText's own reasoning) so this pair never
  // collides with a previous run's leftover rows either.
  it('flags a round rating with duplicate when its free_text is a reworded near-duplicate, not an exact match', async () => {
    const candidateCookieA = await loginNewCandidate();
    const candidateCookieB = await loginNewCandidate();
    const roundA = await createRound(await createProcess(candidateCookieA));
    const roundB = await createRound(await createProcess(candidateCookieB));

    const core = uniqueFreeText().replace(/\.$/, '');
    const first = await submitRoundRating(
      roundA,
      candidateCookieA,
      `Great interview experience: ${core}.`,
    );
    const second = await submitRoundRating(
      roundB,
      candidateCookieB,
      `Really great interview, honestly - ${core.toLowerCase()} overall.`,
    );

    expect(first.queueEntry.flagReason).toBeNull();
    expect(second.queueEntry.flagReason).toBe('duplicate');
  }, 20000);

  it('does not flag distinct free_text submissions', async () => {
    const candidateCookie = await loginNewCandidate();
    const roundId = await createRound(await createProcess(candidateCookie));

    const { queueEntry } = await submitRoundRating(roundId, candidateCookie, uniqueFreeText());

    expect(queueEntry.flagReason).toBeNull();
  }, 15000);
});
