import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { PrismaExceptionFilter } from '../src/common/prisma-exception.filter';
import { loginAsCandidate } from './support/candidate-session';

interface CompanyBody {
  id: string;
}
interface ProcessBody {
  id: string;
}
interface RoundBody {
  id: string;
  typeMetadata: Record<string, unknown> | null;
}
interface FieldOptionsResponse {
  coding: { fields: Array<{ key: string; kind: string; options?: string[] }> };
  other: { fields: Array<{ key: string; kind: string; options?: string[] }> };
}

function body<T>(res: request.Response): T {
  return res.body as T;
}

const unique = () => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

// GitHub issue #248 (Phase 24) — round-type registry + type_metadata
// schemas for all 8 round types, with controlled-vocabulary values sourced
// from the admin-manageable round_type_field_options table (D47).
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

    const companyRes = await server()
      .post('/companies')
      .set('Cookie', cookie)
      .send({ name: 'Acme Corp', slug: `acme-${unique()}`, sizeBucket: 'mid' })
      .expect(201);
    const companyId = body<CompanyBody>(companyRes).id;

    const processRes = await server()
      .post(`/companies/${companyId}/processes`)
      .set('Cookie', cookie)
      .send({ roleTitle: 'Senior Backend Engineer', outcome: 'in_progress' })
      .expect(201);
    const processId = body<ProcessBody>(processRes).id;

    return { cookie, processId };
  }

  describe('GET /round-types/field-options', () => {
    it('is public and returns all 8 round types with seeded options for controlled fields', async () => {
      const res = await server().get('/round-types/field-options').expect(200);
      const schema = body<FieldOptionsResponse>(res);

      expect(Object.keys(schema)).toHaveLength(8);

      const problemAlgorithms = schema.coding.fields.find((f) => f.key === 'problemAlgorithms');
      expect(problemAlgorithms?.kind).toBe('controlled-multi');
      expect(problemAlgorithms?.options).toEqual(expect.arrayContaining(['DFS', 'BFS']));

      const problemDescription = schema.coding.fields.find(
        (f) => f.key === 'problemDescription',
      );
      expect(problemDescription?.kind).toBe('text');
      expect(problemDescription?.options).toBeUndefined();

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
});
