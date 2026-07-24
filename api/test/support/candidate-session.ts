import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { getMailpitMessage, waitForMailpitMessage } from './mailpit';

export interface CandidateSession {
  cookie: string;
  candidateId: string;
}

// Drives the real magic-link flow (GitHub issues #145/#146) end to end —
// request a link, extract its token from Mailpit, consume it — since
// POST /candidates no longer exists as a standalone public endpoint
// (issue #146: candidate creation is part of the auth flow now). Returns
// both the session cookie every write-path call needs and the
// candidateId, decoded from the JWT payload without re-verifying it —
// fine for test assertions, since the server already verified it when
// issuing the token in the first place.
export async function loginAsCandidate(
  app: INestApplication,
  email: string,
): Promise<CandidateSession> {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- getHttpServer()'s return type doesn't line up with supertest's App type
  const server = () => request(app.getHttpServer());

  await server().post('/auth/request-link').send({ email }).expect(200);
  const message = await waitForMailpitMessage(email);
  const full = await getMailpitMessage(message.ID);
  const token = /token=([0-9a-f]{64})/.exec(full.Text)?.[1];
  if (!token) throw new Error(`No token found in the email sent to ${email}`);

  const verifyRes = await server().get(`/auth/verify?token=${token}`).expect(200);
  const cookies = verifyRes.headers['set-cookie'] as unknown as string[];
  const cookie = cookies.find((c) => c.startsWith('candidate_session='));
  if (!cookie) throw new Error('No candidate_session cookie set after verify.');

  const jwt = cookie.split(';')[0].split('=')[1];
  const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64').toString()) as {
    candidateId: string;
  };

  return { cookie, candidateId: payload.candidateId };
}
