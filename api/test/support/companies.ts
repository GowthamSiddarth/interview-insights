import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { loginAsAdmin } from './admin-session';
import { findQueueEntry, QueueGroupBody } from './moderation-queue';

export interface CreatedCompany {
  id: string;
  name: string;
  slug: string;
  sizeBucket: string;
}

const unique = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

// GitHub issue #369 (Phase 35) — company creation now goes through
// moderation like everything else (CLAUDE.md hard constraint #2), so
// every e2e spec that needs an *immediately usable* company (searchable,
// a valid target for process creation, listed publicly) must create it
// and then approve it as an admin, same two-step shape every other
// moderated entity type already needs.
export async function createApprovedCompany(
  app: INestApplication,
  candidateCookie: string,
  overrides: Partial<{ name: string; slug: string; sizeBucket: string }> = {},
): Promise<CreatedCompany> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- getHttpServer()'s return type doesn't line up with supertest's App type
  const server = () => request(app.getHttpServer());
  const marker = unique();

  const createRes = await server()
    .post('/companies')
    .set('Cookie', candidateCookie)
    .send({
      name: overrides.name ?? `Test Co ${marker}`,
      slug: overrides.slug ?? `test-co-${marker}`,
      sizeBucket: overrides.sizeBucket ?? 'mid',
    })
    .expect(201);
  const company = createRes.body as CreatedCompany;

  const adminCookie = await loginAsAdmin(app);
  const queueRes = await server().get('/moderation/queue').set('Cookie', adminCookie).expect(200);
  const entry = findQueueEntry(queueRes.body as QueueGroupBody[], company.id);
  if (!entry) {
    throw new Error(`No moderation_queue entry found for company ${company.id}`);
  }

  await server()
    .post(`/moderation/queue/${entry.id}/approve`)
    .set('Cookie', adminCookie)
    .send({})
    .expect(201);

  return company;
}

// A pending company request, left unapproved — for tests proving the
// moderation gate itself (hidden from public reads, rejected as a
// process-creation target, etc.).
export async function createPendingCompany(
  app: INestApplication,
  candidateCookie: string,
  overrides: Partial<{ name: string; slug: string; sizeBucket: string }> = {},
): Promise<CreatedCompany> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- getHttpServer()'s return type doesn't line up with supertest's App type
  const server = () => request(app.getHttpServer());
  const marker = unique();

  const createRes = await server()
    .post('/companies')
    .set('Cookie', candidateCookie)
    .send({
      name: overrides.name ?? `Test Co ${marker}`,
      slug: overrides.slug ?? `test-co-${marker}`,
      sizeBucket: overrides.sizeBucket ?? 'mid',
    })
    .expect(201);

  return createRes.body as CreatedCompany;
}

// Finds the still-unreviewed queue entry for a given company id —
// exported separately for tests that need to act on it directly
// (reject, or assert its enriched fields) rather than always approving.
export async function findCompanyQueueEntryId(
  app: INestApplication,
  adminCookie: string,
  companyId: string,
): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- getHttpServer()'s return type doesn't line up with supertest's App type
  const queueRes = await request(app.getHttpServer())
    .get('/moderation/queue')
    .set('Cookie', adminCookie)
    .expect(200);
  const entry = findQueueEntry(queueRes.body as QueueGroupBody[], companyId);
  if (!entry) {
    throw new Error(`No moderation_queue entry found for company ${companyId}`);
  }
  return entry.id;
}
