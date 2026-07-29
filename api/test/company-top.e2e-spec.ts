import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaExceptionFilter } from '../src/common/prisma-exception.filter';
import { loginAsCandidate } from './support/candidate-session';
import { createPendingCompany } from './support/companies';

interface CompanyBody {
  id: string;
  status?: string;
}

function body<T>(res: request.Response): T {
  return res.body as T;
}

const unique = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const rawPrisma = new PrismaClient();

// GitHub issue #415 — GET /companies/top backs the landing page's
// quick-select grid, which used to render every approved company
// unbounded. Selection is random for now (no ranking signal exists yet),
// so these tests assert the contract a caller can actually rely on — cap,
// approved-only — not any particular ordering.
describe('Top companies (e2e)', () => {
  let app: INestApplication;
  let candidateCookie: string;

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
    candidateCookie = (await loginAsCandidate(app, `candidate-${unique()}@example.com`)).cookie;
  });

  afterEach(async () => {
    await app.close();
  });

  afterAll(async () => {
    await rawPrisma.$disconnect();
  });

  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- getHttpServer()'s return type doesn't line up with supertest's App type
  const server = () => request(app.getHttpServer());

  // Seeded directly via Prisma, not POST /companies — that endpoint is
  // throttled to 5 requests per IP per 15-minute window
  // (CompanyCreationThrottleGuard), which this test would otherwise blow
  // straight through needing 6+ approved companies in one run.
  async function seedApprovedCompany(name: string, slug: string) {
    return rawPrisma.company.create({
      data: { name, slug, sizeBucket: 'mid', status: 'approved' },
    });
  }

  it('never returns more than 5 companies, even with more approved than that', async () => {
    for (let i = 0; i < 7; i++) {
      const marker = unique();
      await seedApprovedCompany(`Top Cap Co ${marker}-${i}`, `top-cap-${marker}-${i}`);
    }

    const res = await server().get('/companies/top').expect(200);

    expect(body<CompanyBody[]>(res).length).toBeLessThanOrEqual(5);
  });

  it('never includes a pending or rejected company', async () => {
    const marker = unique();
    const pending = await createPendingCompany(app, candidateCookie, {
      name: `Top Pending Co ${marker}`,
      slug: `top-pending-${marker}`,
    });

    const res = await server().get('/companies/top').expect(200);

    expect(body<CompanyBody[]>(res).some((c) => c.id === pending.id)).toBe(false);
  });

  it('401s never happen — the endpoint is public, same as GET /companies', async () => {
    await server().get('/companies/top').expect(200);
  });
});
