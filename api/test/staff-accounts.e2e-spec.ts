import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { PrismaExceptionFilter } from '../src/common/prisma-exception.filter';
import { loginAsAdmin, loginAsSecondModerator, loginAsStaff } from './support/admin-session';

// GitHub issue #607 — a raw connection, bypassing the app's own guarded
// endpoints, same pattern moderation.e2e-spec.ts's own rawPrisma already
// uses: `moderators` isn't one of truncate-database.ts's wiped tables (see
// admin-session.ts's own comment), so admin-role rows created by earlier
// test runs — including this file's own "allows deactivating..." test,
// which deliberately leaves a second admin active — persist and would
// otherwise make the last-admin guard tests' "this is the only active
// non-root admin" precondition false.
const rawPrisma = new PrismaClient();

interface StaffAccountBody {
  id: string;
  username: string;
  email: string;
  role: string;
  isActive: boolean;
  createdById: string | null;
  createdAt: string;
  password?: string;
}

function body<T>(res: request.Response): T {
  return res.body as T;
}

// GitHub issue #589 (Phase 42, D99) — the admin:staff:manage side of the
// role hierarchy: create/list/update-role/deactivate/reactivate, admin-
// initiated password reset, every action durably audited.
describe('Staff accounts (e2e)', () => {
  let app: INestApplication;
  let adminCookie: string;

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

  afterAll(async () => {
    await rawPrisma.$disconnect();
  });

  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- getHttpServer()'s return type doesn't line up with supertest's App type
  const server = () => request(app.getHttpServer());

  // GitHub issue #607 — bypasses the guarded /deactivate endpoint (which
  // would itself refuse to deactivate a last-remaining admin) to force a
  // clean "exactly one active non-root admin" precondition regardless of
  // what earlier tests/runs left behind.
  async function deactivateEveryOtherActiveAdmin(exceptId: string): Promise<void> {
    await rawPrisma.moderator.updateMany({
      where: { role: 'admin', isActive: true, createdById: { not: null }, id: { not: exceptId } },
      data: { isActive: false },
    });
  }
  const uniqueUsername = () => `staff-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

  it('rejects unauthenticated requests with 401', async () => {
    await server().get('/admin/staff').expect(401);
    await server()
      .post('/admin/staff')
      .send({ username: uniqueUsername(), email: 'x@example.com', role: 'staff' })
      .expect(401);
  });

  it('403s a moderator (not admin) trying to manage staff accounts', async () => {
    const moderator = await loginAsSecondModerator(app);

    await server().get('/admin/staff').set('Cookie', moderator.cookie).expect(403);
    await server()
      .post('/admin/staff')
      .set('Cookie', moderator.cookie)
      .send({ username: uniqueUsername(), email: 'x@example.com', role: 'staff' })
      .expect(403);
  });

  it('403s a staff account trying to manage staff accounts', async () => {
    const staff = await loginAsStaff(app);

    await server().get('/admin/staff').set('Cookie', staff.cookie).expect(403);
  });

  it('creates an account with a one-time password, then lists it without ever exposing a password hash', async () => {
    const username = uniqueUsername();

    const createRes = await server()
      .post('/admin/staff')
      .set('Cookie', adminCookie)
      .send({ username, email: `${username}@example.com`, role: 'moderator' })
      .expect(201);
    const created = body<StaffAccountBody>(createRes);
    expect(created).toMatchObject({ username, role: 'moderator', isActive: true });
    expect(typeof created.password).toBe('string');
    expect((created.password as string).length).toBeGreaterThan(0);

    const listRes = await server().get('/admin/staff').set('Cookie', adminCookie).expect(200);
    const list = body<StaffAccountBody[]>(listRes);
    const listed = list.find((a) => a.id === created.id);
    expect(listed).toBeDefined();
    expect(listed).not.toHaveProperty('password');
    expect(listed).not.toHaveProperty('passwordHash');

    // The one-time password actually works.
    const loginRes = await server()
      .post('/auth/admin/login')
      .send({ username, password: created.password })
      .expect(200);
    expect(loginRes.headers['set-cookie']).toBeDefined();
  });

  // GitHub issue #799 (Phase 54) — the read side of every mutation this
  // controller's own routes already durably audit.
  it('surfaces the audit log for a mutating action, most-recent-first, with usernames resolved', async () => {
    const username = uniqueUsername();
    const createRes = await server()
      .post('/admin/staff')
      .set('Cookie', adminCookie)
      .send({ username, email: `${username}@example.com`, role: 'moderator' })
      .expect(201);
    const created = body<StaffAccountBody>(createRes);

    await server()
      .patch(`/admin/staff/${created.id}/role`)
      .set('Cookie', adminCookie)
      .send({ role: 'staff' })
      .expect(200);

    const auditRes = await server().get('/admin/staff/audit-log').set('Cookie', adminCookie).expect(200);
    const entries = body<
      Array<{ targetId: string; targetUsername: string; action: string; detail: unknown }>
    >(auditRes);
    const forThisAccount = entries.filter((e) => e.targetId === created.id);

    // Most-recent-first: the role_changed entry (created second) comes
    // before account_created (created first).
    expect(forThisAccount[0]).toMatchObject({ action: 'role_changed', targetUsername: username });
    expect(forThisAccount[1]).toMatchObject({ action: 'account_created', targetUsername: username });
  });

  it('rejects an unauthenticated request to the audit log with 401', async () => {
    await server().get('/admin/staff/audit-log').expect(401);
  });

  it('rejects a duplicate username with 409', async () => {
    const username = uniqueUsername();
    await server()
      .post('/admin/staff')
      .set('Cookie', adminCookie)
      .send({ username, email: `${username}@example.com`, role: 'staff' })
      .expect(201);

    await server()
      .post('/admin/staff')
      .set('Cookie', adminCookie)
      .send({ username, email: `${username}-2@example.com`, role: 'staff' })
      .expect(409);
  });

  it('updates a staff account\'s role', async () => {
    const username = uniqueUsername();
    const createRes = await server()
      .post('/admin/staff')
      .set('Cookie', adminCookie)
      .send({ username, email: `${username}@example.com`, role: 'staff' })
      .expect(201);
    const { id } = body<StaffAccountBody>(createRes);

    const updateRes = await server()
      .patch(`/admin/staff/${id}/role`)
      .set('Cookie', adminCookie)
      .send({ role: 'moderator' })
      .expect(200);
    expect(body<StaffAccountBody>(updateRes).role).toBe('moderator');
  });

  it('deactivating an account blocks login; reactivating restores it', async () => {
    const username = uniqueUsername();
    const createRes = await server()
      .post('/admin/staff')
      .set('Cookie', adminCookie)
      .send({ username, email: `${username}@example.com`, role: 'staff' })
      .expect(201);
    const { id, password } = body<StaffAccountBody>(createRes);

    await server().post(`/admin/staff/${id}/deactivate`).set('Cookie', adminCookie).expect(201);
    await server().post('/auth/admin/login').send({ username, password }).expect(401);

    await server().post(`/admin/staff/${id}/reactivate`).set('Cookie', adminCookie).expect(201);
    await server().post('/auth/admin/login').send({ username, password }).expect(200);
  });

  it('admin-initiated password reset invalidates the old password and issues a new one', async () => {
    const username = uniqueUsername();
    const createRes = await server()
      .post('/admin/staff')
      .set('Cookie', adminCookie)
      .send({ username, email: `${username}@example.com`, role: 'staff' })
      .expect(201);
    const { id, password: oldPassword } = body<StaffAccountBody>(createRes);

    const resetRes = await server()
      .post(`/admin/staff/${id}/reset-password`)
      .set('Cookie', adminCookie)
      .expect(201);
    const { password: newPassword } = body<{ password: string }>(resetRes);
    expect(newPassword).not.toBe(oldPassword);

    await server().post('/auth/admin/login').send({ username, password: oldPassword }).expect(401);
    await server().post('/auth/admin/login').send({ username, password: newPassword }).expect(200);
  });

  it('returns 404 for acting on a non-existent staff account', async () => {
    await server()
      .patch('/admin/staff/123e4567-e89b-12d3-a456-426614174000/role')
      .set('Cookie', adminCookie)
      .send({ role: 'moderator' })
      .expect(404);
    await server()
      .post('/admin/staff/123e4567-e89b-12d3-a456-426614174000/deactivate')
      .set('Cookie', adminCookie)
      .expect(404);
  });

  // GitHub issue #607 — the root admin (createdById: null) is never
  // listed or actionable through this API; it's managed by
  // infra/scripts/rotate-admin-credentials.sh only.
  describe('root admin exclusion', () => {
    it('never appears in the list', async () => {
      const meRes = await server().get('/auth/admin/me').set('Cookie', adminCookie).expect(200);
      const { id: rootId } = body<{ id: string }>(meRes);

      const listRes = await server().get('/admin/staff').set('Cookie', adminCookie).expect(200);
      const ids = body<StaffAccountBody[]>(listRes).map((a) => a.id);
      expect(ids).not.toContain(rootId);
    });

    it('403s every mutating action targeted at the root admin id', async () => {
      const meRes = await server().get('/auth/admin/me').set('Cookie', adminCookie).expect(200);
      const { id: rootId } = body<{ id: string }>(meRes);

      await server()
        .patch(`/admin/staff/${rootId}/role`)
        .set('Cookie', adminCookie)
        .send({ role: 'staff' })
        .expect(403);
      await server().post(`/admin/staff/${rootId}/deactivate`).set('Cookie', adminCookie).expect(403);
      await server().post(`/admin/staff/${rootId}/reactivate`).set('Cookie', adminCookie).expect(403);
      await server().post(`/admin/staff/${rootId}/reset-password`).set('Cookie', adminCookie).expect(403);
    });
  });

  // GitHub issue #607 — deactivating or demoting the last remaining
  // active non-root admin would leave the staff-management UI with no
  // manageable admin at all (root doesn't count — see the service's own
  // comment on why counting it would make this guard meaningless).
  describe('last-admin guard', () => {
    it('rejects deactivating the last remaining active non-root admin', async () => {
      const username = uniqueUsername();
      const createRes = await server()
        .post('/admin/staff')
        .set('Cookie', adminCookie)
        .send({ username, email: `${username}@example.com`, role: 'admin' })
        .expect(201);
      const { id } = body<StaffAccountBody>(createRes);
      await deactivateEveryOtherActiveAdmin(id);

      await server().post(`/admin/staff/${id}/deactivate`).set('Cookie', adminCookie).expect(409);
    });

    it('rejects demoting the last remaining active non-root admin', async () => {
      const username = uniqueUsername();
      const createRes = await server()
        .post('/admin/staff')
        .set('Cookie', adminCookie)
        .send({ username, email: `${username}@example.com`, role: 'admin' })
        .expect(201);
      const { id } = body<StaffAccountBody>(createRes);
      await deactivateEveryOtherActiveAdmin(id);

      await server()
        .patch(`/admin/staff/${id}/role`)
        .set('Cookie', adminCookie)
        .send({ role: 'moderator' })
        .expect(409);
    });

    it('allows deactivating an admin once a second active non-root admin exists', async () => {
      const usernameA = uniqueUsername();
      const createResA = await server()
        .post('/admin/staff')
        .set('Cookie', adminCookie)
        .send({ username: usernameA, email: `${usernameA}@example.com`, role: 'admin' })
        .expect(201);
      const { id: idA } = body<StaffAccountBody>(createResA);

      const usernameB = uniqueUsername();
      const createResB = await server()
        .post('/admin/staff')
        .set('Cookie', adminCookie)
        .send({ username: usernameB, email: `${usernameB}@example.com`, role: 'admin' })
        .expect(201);
      const { id: idB } = body<StaffAccountBody>(createResB);

      await server().post(`/admin/staff/${idA}/deactivate`).set('Cookie', adminCookie).expect(201);

      // Cleanup: idB would otherwise stay active forever (moderators isn't
      // truncated between test runs) and keep satisfying every future
      // "last admin" test's precondition-clearing helper above trivially —
      // deactivateEveryOtherActiveAdmin() already handles that case, but
      // there's no reason to let unique-per-run rows accumulate unbounded.
      await rawPrisma.moderator.update({ where: { id: idB }, data: { isActive: false } });
    });
  });
});
