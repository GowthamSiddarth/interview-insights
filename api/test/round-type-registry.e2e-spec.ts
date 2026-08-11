import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { PrismaExceptionFilter } from '../src/common/prisma-exception.filter';
import { loginAsCandidate } from './support/candidate-session';
import { loginAsAdmin, loginAsStaff } from './support/admin-session';
import { createApprovedCompany } from './support/companies';

interface ProcessBody {
  id: string;
}
interface RoundBody {
  id: string;
  title: string | null;
  typeMetadata: Record<string, unknown> | null;
}
interface FieldOptionsResponse {
  coding: { fields: Array<{ key: string; kind: string; options?: string[] }> };
  tech_screening: { fields: Array<{ key: string; kind: string; options?: string[] }> };
  other: { fields: Array<{ key: string; kind: string; options?: string[] }> };
}
interface FieldOptionRow {
  id: string;
  roundType: string;
  fieldKey: string;
  value: string;
  sortOrder: number;
  isActive: boolean;
}

function body<T>(res: request.Response): T {
  return res.body as T;
}

const unique = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

// GitHub issue #248 (Phase 24) — round-type registry + type_metadata
// schemas for all 9 round types (8 originally, plus "tech_screening" added
// in Phase 28 issue #284), with controlled-vocabulary values sourced from
// the admin-manageable round_type_field_options table (D47).
describe('Round-type registry (e2e)', () => {
  let app: INestApplication;

  // Fresh app per test — same reasoning as every other Phase 16+ e2e spec:
  // a shared instance's cumulative magic-link requests would trip the
  // per-candidate throttle.
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
  });

  afterEach(async () => {
    await app.close();
  });

  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- getHttpServer()'s return type doesn't line up with supertest's App type
  const server = () => request(app.getHttpServer());

  async function createProcess(): Promise<{ cookie: string; processId: string }> {
    const { cookie } = await loginAsCandidate(app, `candidate-${unique()}@example.com`);

    const { id: companyId } = await createApprovedCompany(app, cookie, {
      name: 'Acme Corp',
      slug: `acme-${unique()}`,
    });

    const processRes = await server()
      .post(`/companies/${companyId}/processes`)
      .set('Cookie', cookie)
      .send({ roleTitle: 'Senior Backend Engineer', outcome: 'in_progress' })
      .expect(201);
    const processId = body<ProcessBody>(processRes).id;

    return { cookie, processId };
  }

  describe('GET /round-types/field-options', () => {
    it('is public and returns all 9 round types with seeded options for controlled fields', async () => {
      const res = await server().get('/round-types/field-options').expect(200);
      const schema = body<FieldOptionsResponse>(res);

      expect(Object.keys(schema)).toHaveLength(9);

      const problemAlgorithms = schema.coding.fields.find((f) => f.key === 'problemAlgorithms');
      expect(problemAlgorithms?.kind).toBe('controlled-multi');
      expect(problemAlgorithms?.options).toEqual(expect.arrayContaining(['DFS', 'BFS']));

      const problemDescription = schema.coding.fields.find(
        (f) => f.key === 'problemDescription',
      );
      expect(problemDescription?.kind).toBe('text');
      expect(problemDescription?.options).toBeUndefined();

      const screeningFormat = schema.tech_screening.fields.find(
        (f) => f.key === 'screeningFormat',
      );
      expect(screeningFormat?.kind).toBe('controlled-single');
      expect(screeningFormat?.options).toEqual(
        expect.arrayContaining(['Phone Call', 'Video Call', 'In Person']),
      );

      expect(schema.other.fields).toEqual([{ key: 'notes', kind: 'text' }]);
    });
  });

  describe('POST /processes/:processId/rounds — type_metadata validation', () => {
    it('round-trips valid coding type_metadata (controlled + free-text fields)', async () => {
      const { processId } = await createProcess();

      const createRes = await server()
        .post(`/processes/${processId}/rounds`)
        .send({
          sequenceNumber: 1,
          title: 'Technical Screen',
          roundType: 'coding',
          typeMetadata: {
            problemAlgorithms: ['DFS', 'BFS'],
            problemDataStructures: ['Graph'],
            problemDescription: 'Find shortest path in an unweighted graph',
          },
        })
        .expect(201);
      const roundId = body<RoundBody>(createRes).id;

      const listRes = await server().get(`/processes/${processId}/rounds`).expect(200);
      const rounds = body<RoundBody[]>(listRes);
      const created = rounds.find((r) => r.id === roundId);
      expect(created?.typeMetadata).toEqual({
        problemAlgorithms: ['DFS', 'BFS'],
        problemDataStructures: ['Graph'],
        problemDescription: 'Find shortest path in an unweighted graph',
      });
    });

    it('round-trips a leadership round using the newly-added principlesAsked field', async () => {
      const { processId } = await createProcess();

      const createRes = await server()
        .post(`/processes/${processId}/rounds`)
        .send({
          sequenceNumber: 1,
          title: 'Leadership Round',
          roundType: 'leadership',
          typeMetadata: { principlesAsked: ['Ownership', 'Deliver Results'] },
        })
        .expect(201);
      expect(body<RoundBody>(createRes).typeMetadata).toEqual({
        principlesAsked: ['Ownership', 'Deliver Results'],
      });
    });

    it('round-trips a tech_screening round using its own screeningFormat/topicsCovered fields (GitHub issue #284)', async () => {
      const { processId } = await createProcess();

      const createRes = await server()
        .post(`/processes/${processId}/rounds`)
        .send({
          sequenceNumber: 1,
          title: 'Recruiter Tech Screen',
          roundType: 'tech_screening',
          typeMetadata: {
            screeningFormat: 'Phone Call',
            topicsCovered: ['Resume Walkthrough', 'Basic Technical Q&A'],
          },
        })
        .expect(201);
      expect(body<RoundBody>(createRes).typeMetadata).toEqual({
        screeningFormat: 'Phone Call',
        topicsCovered: ['Resume Walkthrough', 'Basic Technical Q&A'],
      });
    });

    it('rejects an inactive tech_screening controlled-vocabulary value', async () => {
      const { processId } = await createProcess();

      await server()
        .post(`/processes/${processId}/rounds`)
        .send({
          sequenceNumber: 1,
          title: 'Recruiter Tech Screen',
          roundType: 'tech_screening',
          typeMetadata: { screeningFormat: 'Carrier Pigeon' },
        })
        .expect(400);
    });

    it('rejects a controlled-vocabulary value that is not currently active', async () => {
      const { processId } = await createProcess();

      await server()
        .post(`/processes/${processId}/rounds`)
        .send({
          sequenceNumber: 1,
          title: 'Technical Screen',
          roundType: 'coding',
          typeMetadata: { problemAlgorithms: ['Not A Real Algorithm'] },
        })
        .expect(400);
    });

    it('rejects a type_metadata key that is not part of this round type\'s schema', async () => {
      const { processId } = await createProcess();

      await server()
        .post(`/processes/${processId}/rounds`)
        .send({
          sequenceNumber: 1,
          title: 'Behavioral Round',
          roundType: 'behavioral',
          typeMetadata: { principlesAsked: ['Ownership'] }, // a leadership field, not behavioral
        })
        .expect(400);
    });

    it('accepts a round with no title at all (GitHub issue #287 — optional)', async () => {
      const { processId } = await createProcess();

      const createRes = await server()
        .post(`/processes/${processId}/rounds`)
        .send({ sequenceNumber: 1, roundType: 'coding' })
        .expect(201);
      const createdId = body<RoundBody>(createRes).id;
      expect(body<RoundBody>(createRes).title).toBeNull();

      const listRes = await server().get(`/processes/${processId}/rounds`).expect(200);
      const created = body<RoundBody[]>(listRes).find((r) => r.id === createdId);
      expect(created?.title).toBeNull();
    });

    it('accepts an `other` round with only its free-text notes field', async () => {
      const { processId } = await createProcess();

      await server()
        .post(`/processes/${processId}/rounds`)
        .send({
          sequenceNumber: 1,
          title: 'Unusual Round',
          roundType: 'other',
          typeMetadata: { notes: 'Take-home followed by a live walkthrough' },
        })
        .expect(201);
    });
  });

  // GitHub issue #263 (Phase 27) — the admin write side of the registry
  // issue #248 only built the read side of.
  describe('Admin round-type field-options CRUD', () => {
    const unique2 = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

    it('rejects unauthenticated requests with 401', async () => {
      await server().get('/admin/round-types/coding/field-options').expect(401);
      await server()
        .post('/admin/round-types/coding/field-options')
        .send({ fieldKey: 'problemAlgorithms', value: 'A*' })
        .expect(401);
      await server()
        .patch('/admin/round-types/field-options/123e4567-e89b-12d3-a456-426614174000')
        .send({ isActive: false })
        .expect(401);
    });

    it('adds a new value that immediately appears in both the admin list and the public read endpoint', async () => {
      const adminCookie = await loginAsAdmin(app);
      const value = `Custom Algo ${unique2()}`;

      const createRes = await server()
        .post('/admin/round-types/coding/field-options')
        .set('Cookie', adminCookie)
        .send({ fieldKey: 'problemAlgorithms', value })
        .expect(201);
      const created = body<FieldOptionRow>(createRes);
      expect(created).toMatchObject({
        roundType: 'coding',
        fieldKey: 'problemAlgorithms',
        value,
        isActive: true,
      });

      const adminListRes = await server()
        .get('/admin/round-types/coding/field-options')
        .set('Cookie', adminCookie)
        .expect(200);
      expect(body<FieldOptionRow[]>(adminListRes).some((r) => r.id === created.id)).toBe(true);

      const publicRes = await server().get('/round-types/field-options').expect(200);
      const problemAlgorithms = body<FieldOptionsResponse>(publicRes).coding.fields.find(
        (f) => f.key === 'problemAlgorithms',
      );
      expect(problemAlgorithms?.options).toContain(value);
    });

    it('rejects an unknown fieldKey', async () => {
      const adminCookie = await loginAsAdmin(app);

      await server()
        .post('/admin/round-types/coding/field-options')
        .set('Cookie', adminCookie)
        .send({ fieldKey: 'notAField', value: 'x' })
        .expect(400);
    });

    it('rejects a text field — no admin-managed vocabulary exists for it', async () => {
      const adminCookie = await loginAsAdmin(app);

      await server()
        .post('/admin/round-types/coding/field-options')
        .set('Cookie', adminCookie)
        .send({ fieldKey: 'problemDescription', value: 'x' })
        .expect(400);
    });

    it('rejects a duplicate (roundType, fieldKey, value) with a 409', async () => {
      const adminCookie = await loginAsAdmin(app);
      const value = `Dup Algo ${unique2()}`;

      await server()
        .post('/admin/round-types/coding/field-options')
        .set('Cookie', adminCookie)
        .send({ fieldKey: 'problemAlgorithms', value })
        .expect(201);

      await server()
        .post('/admin/round-types/coding/field-options')
        .set('Cookie', adminCookie)
        .send({ fieldKey: 'problemAlgorithms', value })
        .expect(409);
    });

    it('retiring a value removes it from the public endpoint but keeps the row (and it) visible to admins', async () => {
      const adminCookie = await loginAsAdmin(app);
      const value = `Retire Me ${unique2()}`;

      const createRes = await server()
        .post('/admin/round-types/coding/field-options')
        .set('Cookie', adminCookie)
        .send({ fieldKey: 'problemAlgorithms', value })
        .expect(201);
      const { id } = body<FieldOptionRow>(createRes);

      await server()
        .patch(`/admin/round-types/field-options/${id}`)
        .set('Cookie', adminCookie)
        .send({ isActive: false })
        .expect(200);

      const publicRes = await server().get('/round-types/field-options').expect(200);
      const problemAlgorithms = body<FieldOptionsResponse>(publicRes).coding.fields.find(
        (f) => f.key === 'problemAlgorithms',
      );
      expect(problemAlgorithms?.options).not.toContain(value);

      const adminListRes = await server()
        .get('/admin/round-types/coding/field-options')
        .set('Cookie', adminCookie)
        .expect(200);
      const retired = body<FieldOptionRow[]>(adminListRes).find((r) => r.id === id);
      expect(retired).toBeDefined();
      expect(retired?.isActive).toBe(false);
    });

    it('returns 404 for updating a non-existent option', async () => {
      const adminCookie = await loginAsAdmin(app);

      await server()
        .patch('/admin/round-types/field-options/123e4567-e89b-12d3-a456-426614174000')
        .set('Cookie', adminCookie)
        .send({ isActive: false })
        .expect(404);
    });

    // GitHub issue #588 (Phase 42, D99) — a `staff` account can read the
    // registry (D99's "round-type registry" read grant) but has no write
    // permission of any kind, unlike `moderator`/`admin` which both share
    // admin:round_types:write.
    it('lets a staff account list field-options but 403s create/update', async () => {
      const staffCookie = (await loginAsStaff(app)).cookie;

      await server()
        .get('/admin/round-types/coding/field-options')
        .set('Cookie', staffCookie)
        .expect(200);

      await server()
        .post('/admin/round-types/coding/field-options')
        .set('Cookie', staffCookie)
        .send({ fieldKey: 'problemAlgorithms', value: `Staff Attempt ${unique2()}` })
        .expect(403);

      await server()
        .patch('/admin/round-types/field-options/123e4567-e89b-12d3-a456-426614174000')
        .set('Cookie', staffCookie)
        .send({ isActive: false })
        .expect(403);
    });
  });
});
