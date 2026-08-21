import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaExceptionFilter } from '../src/common/prisma-exception.filter';
import { loginAsAdmin } from './support/admin-session';
import { loginAsCandidate } from './support/candidate-session';
import { createPendingCompany, findCompanyQueueEntryId } from './support/companies';

interface CompanyBody {
  id: string;
  slug: string;
  status: string;
}
interface ErrorBody {
  message: string | string[];
}

function body<T>(res: request.Response): T {
  return res.body as T;
}

const unique = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const rawPrisma = new PrismaClient();

// Proves GitHub issue #369's acceptance criteria directly: a pending
// company-creation request is invisible to every public read path until a
// moderator approves it; rejecting keeps the row (status: rejected) rather
// than deleting it, per the resolved Phase 35 design decision; and a
// duplicate request for a still-pending slug gets a distinct, friendly
// message instead of the generic unique-constraint conflict. See
// docs/DECISIONS.md for the full write-up. Company creation and search
// visibility specifically are covered by company-search.e2e-spec.ts and
// moderation.e2e-spec.ts's own "company creation requests" tests — this
// file focuses on the read-path gate and the two business rules unique to
// companies.
describe('Company moderation gate (e2e)', () => {
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

  it('hides a pending company from every public read path', async () => {
    const company = await createPendingCompany(app, candidateCookie, {
      name: 'Pending Read Co',
      slug: `pending-read-${unique()}`,
    });

    await server().get('/companies/by-slug/' + company.slug).expect(404);
    await server().get(`/companies/${company.id}`).expect(404);
    await server().get(`/companies/${company.id}/reviews`).expect(404);
    await server().get(`/companies/${company.id}/analytics`).expect(404);

    const list = await server().get('/companies').expect(200);
    expect(body<{ items: CompanyBody[] }>(list).items.some((c) => c.id === company.id)).toBe(false);
  });

  it('rejects creating an interview process against a pending company (single and bulk endpoints)', async () => {
    const company = await createPendingCompany(app, candidateCookie, {
      name: 'Pending Process Co',
      slug: `pending-process-${unique()}`,
    });

    await server()
      .post(`/companies/${company.id}/processes`)
      .set('Cookie', candidateCookie)
      .send({ roleTitle: 'Engineer', outcome: 'in_progress' })
      .expect(404);

    await server()
      .post(`/companies/${company.id}/processes/bulk`)
      .set('Cookie', candidateCookie)
      .send({ roleTitle: 'Engineer', outcome: 'in_progress' })
      .expect(404);
  });

  it('approving makes the company visible on every public read path', async () => {
    const company = await createPendingCompany(app, candidateCookie, {
      name: 'Approve Me Co',
      slug: `approve-me-${unique()}`,
    });
    const adminCookie = await loginAsAdmin(app);
    const entryId = await findCompanyQueueEntryId(app, adminCookie, company.id);

    await server()
      .post(`/moderation/queue/${entryId}/approve`)
      .set('Cookie', adminCookie)
      .send({})
      .expect(201);

    const bySlug = await server().get('/companies/by-slug/' + company.slug).expect(200);
    expect(body<CompanyBody>(bySlug).id).toBe(company.id);
    await server().get(`/companies/${company.id}`).expect(200);
    await server().get(`/companies/${company.id}/reviews`).expect(200);
    await server().get(`/companies/${company.id}/analytics`).expect(200);
    const list = await server().get('/companies').expect(200);
    expect(body<{ items: CompanyBody[] }>(list).items.some((c) => c.id === company.id)).toBe(true);

    // Also now a valid target for process creation.
    await server()
      .post(`/companies/${company.id}/processes`)
      .set('Cookie', candidateCookie)
      .send({ roleTitle: 'Engineer', outcome: 'in_progress' })
      .expect(201);
  });

  // GitHub issue #369 (Phase 35) — a rejected company's row is kept
  // (status: rejected) for an audit trail rather than deleted; it never
  // becomes publicly visible.
  it('rejecting keeps the row (status: rejected) but never makes it public', async () => {
    const company = await createPendingCompany(app, candidateCookie, {
      name: 'Reject Me Co',
      slug: `reject-me-${unique()}`,
    });
    const adminCookie = await loginAsAdmin(app);
    const entryId = await findCompanyQueueEntryId(app, adminCookie, company.id);

    await server()
      .post(`/moderation/queue/${entryId}/reject`)
      .set('Cookie', adminCookie)
      .send({ rejectionReasonCategory: 'other' })
      .expect(201);

    await server().get('/companies/by-slug/' + company.slug).expect(404);
    await server().get(`/companies/${company.id}`).expect(404);

    const row = await rawPrisma.company.findUnique({ where: { id: company.id } });
    expect(row).not.toBeNull();
    expect(row?.status).toBe('rejected');
  });

  // Direct user feedback (Phase 35 planning) — a second request for a name
  // that's already pending should say so plainly, not surface the generic
  // unique-constraint conflict.
  describe('duplicate slug handling', () => {
    it('gives a friendly "already pending" message for a duplicate of a still-pending request', async () => {
      const slug = `dup-pending-${unique()}`;
      await createPendingCompany(app, candidateCookie, { name: 'Dup Co', slug });

      const res = await server()
        .post('/companies')
        .set('Cookie', candidateCookie)
        .send({ name: 'Dup Co', slug, sizeBucket: 'mid' })
        .expect(409);

      expect(body<ErrorBody>(res).message).toMatch(/already been requested and is pending review/);
    });

    it('still gives the generic conflict for a duplicate of an approved company', async () => {
      const slug = `dup-approved-${unique()}`;
      const company = await createPendingCompany(app, candidateCookie, { name: 'Dup Co', slug });
      const adminCookie = await loginAsAdmin(app);
      const entryId = await findCompanyQueueEntryId(app, adminCookie, company.id);
      await server()
        .post(`/moderation/queue/${entryId}/approve`)
        .set('Cookie', adminCookie)
        .send({})
        .expect(201);

      const res = await server()
        .post('/companies')
        .set('Cookie', candidateCookie)
        .send({ name: 'Dup Co', slug, sizeBucket: 'mid' })
        .expect(409);

      expect(body<ErrorBody>(res).message).not.toMatch(/pending review/);
    });

    // GitHub issue #696 (Phase 50, D104) — the whole point of the
    // partial-unique-index migration: a rejected request no longer
    // permanently occupies its slug.
    it('allows a resubmission with the same slug once the original request was rejected', async () => {
      const slug = `dup-rejected-${unique()}`;
      const company = await createPendingCompany(app, candidateCookie, { name: 'Dup Co', slug });
      const adminCookie = await loginAsAdmin(app);
      const entryId = await findCompanyQueueEntryId(app, adminCookie, company.id);
      await server()
        .post(`/moderation/queue/${entryId}/reject`)
        .set('Cookie', adminCookie)
        .send({ rejectionReasonCategory: 'other' })
        .expect(201);

      const res = await server()
        .post('/companies')
        .set('Cookie', candidateCookie)
        .send({ name: 'Dup Co', slug, sizeBucket: 'mid' })
        .expect(201);

      expect(body<{ id: string; slug: string }>(res).slug).toBe(slug);

      // A *second* rejected row sharing the same slug — proves the
      // partial index really doesn't constrain rejected rows at all, not
      // just that one resubmission happened to slip through once.
      const second = await findCompanyQueueEntryId(app, adminCookie, body<{ id: string }>(res).id);
      await server()
        .post(`/moderation/queue/${second}/reject`)
        .set('Cookie', adminCookie)
        .send({ rejectionReasonCategory: 'other' })
        .expect(201);
      await server()
        .post('/companies')
        .set('Cookie', candidateCookie)
        .send({ name: 'Dup Co', slug, sizeBucket: 'mid' })
        .expect(201);
    });
  });

  it('rejects an unauthenticated company creation request', async () => {
    await server()
      .post('/companies')
      .send({ name: 'Anon Co', slug: `anon-${unique()}`, sizeBucket: 'mid' })
      .expect(401);
  });

  // GitHub issue #697 (Phase 50, D104).
  describe('PATCH /companies/:id', () => {
    it("edits and resubmits the owning candidate's own rejected company request", async () => {
      const slug = `edit-rejected-${unique()}`;
      const company = await createPendingCompany(app, candidateCookie, { name: 'Old Name', slug });
      const adminCookie = await loginAsAdmin(app);
      const entryId = await findCompanyQueueEntryId(app, adminCookie, company.id);
      await server()
        .post(`/moderation/queue/${entryId}/reject`)
        .set('Cookie', adminCookie)
        .send({ rejectionReasonCategory: 'other' })
        .expect(201);

      const res = await server()
        .patch(`/companies/${company.id}`)
        .set('Cookie', candidateCookie)
        .send({ name: 'New Name', slug, sizeBucket: 'large' })
        .expect(200);

      expect(body<{ name: string; status: string }>(res)).toMatchObject({
        name: 'New Name',
        status: 'pending',
      });
      const newEntryId = await findCompanyQueueEntryId(app, adminCookie, company.id);
      expect(newEntryId).not.toBe(entryId);
    });

    it("edits and resubmits the owning candidate's own still-pending company request", async () => {
      const company = await createPendingCompany(app, candidateCookie, {
        name: 'Old Name',
        slug: `edit-pending-${unique()}`,
      });

      const res = await server()
        .patch(`/companies/${company.id}`)
        .set('Cookie', candidateCookie)
        .send({ name: 'New Name', slug: company.slug, sizeBucket: 'mid' })
        .expect(200);

      expect(body<{ name: string }>(res).name).toBe('New Name');
    });

    it('rejects an edit from anyone but the owning candidate', async () => {
      const company = await createPendingCompany(app, candidateCookie, {
        name: 'Old Name',
        slug: `edit-other-${unique()}`,
      });
      const otherCookie = (await loginAsCandidate(app, `other-${unique()}@example.com`)).cookie;

      await server()
        .patch(`/companies/${company.id}`)
        .set('Cookie', otherCookie)
        .send({ name: 'New Name', slug: company.slug, sizeBucket: 'mid' })
        .expect(403);
    });

    it('rejects editing an approved company, even by its own requester', async () => {
      const company = await createPendingCompany(app, candidateCookie, {
        name: 'Old Name',
        slug: `edit-approved-${unique()}`,
      });
      const adminCookie = await loginAsAdmin(app);
      const entryId = await findCompanyQueueEntryId(app, adminCookie, company.id);
      await server()
        .post(`/moderation/queue/${entryId}/approve`)
        .set('Cookie', adminCookie)
        .send({})
        .expect(201);

      await server()
        .patch(`/companies/${company.id}`)
        .set('Cookie', candidateCookie)
        .send({ name: 'New Name', slug: company.slug, sizeBucket: 'mid' })
        .expect(403);
    });

    it('rejects an unauthenticated edit request', async () => {
      const company = await createPendingCompany(app, candidateCookie, {
        name: 'Old Name',
        slug: `edit-anon-${unique()}`,
      });

      await server()
        .patch(`/companies/${company.id}`)
        .send({ name: 'New Name', slug: company.slug, sizeBucket: 'mid' })
        .expect(401);
    });

    // GitHub issue #828 (Phase 57) — a true partial update: sending only
    // `industry` must leave name/slug/sizeBucket untouched, not reject
    // outright for omitting them.
    it('a true partial update: sending only industry leaves the other fields untouched', async () => {
      const slug = `edit-partial-${unique()}`;
      const company = await createPendingCompany(app, candidateCookie, {
        name: 'Old Name',
        slug,
        sizeBucket: 'mid',
      });

      const res = await server()
        .patch(`/companies/${company.id}`)
        .set('Cookie', candidateCookie)
        .send({ industry: 'fintech' })
        .expect(200);

      expect(body<{ name: string; slug: string; sizeBucket: string; industry: string | null }>(res)).toMatchObject({
        name: 'Old Name',
        slug,
        sizeBucket: 'mid',
        industry: 'fintech',
      });
    });
  });
});
