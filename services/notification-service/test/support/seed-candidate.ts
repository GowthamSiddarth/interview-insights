import { randomUUID, createCipheriv, randomBytes } from 'crypto';
import { PrismaClient } from '@prisma/client';

// Same iv||authTag||ciphertext layout as
// src/candidates/email-encryption.util.ts's decryptEmail() expects — kept
// here, not imported from src/, so this genuinely proves interop with a
// value nothing in this service's own runtime code constructed, the same
// "independently constructed fixture" reasoning as
// email-encryption.util.spec.ts's encryptFixture().
function encryptEmail(email: string, hexKey: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(hexKey, 'hex'), iv);
  const ciphertext = Buffer.concat([cipher.update(email, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

// api's own write path (CandidatesService.create()) is what really
// populates this row in production — this stands in for it so the e2e
// spec doesn't need api itself running as part of notification-service's
// own CI job (each service's job is isolated, same as every other job in
// .github/workflows/ci.yml). Raw SQL, not `prisma.candidate.create()`:
// this service's own schema.prisma (D75) deliberately only models the
// columns its real query code touches (id, email_encrypted) — the real
// `candidates` table also has a NOT NULL `email_hash` with no default,
// which this fixture has to satisfy but which this service's own runtime
// code never needs to know exists.
export async function seedCandidateWithEmail(prisma: PrismaClient, email: string): Promise<string> {
  const key = process.env.EMAIL_ENCRYPTION_KEY;
  if (!key) throw new Error('EMAIL_ENCRYPTION_KEY must be set to seed a candidate for e2e tests.');

  const id = randomUUID();
  const fixtureEmailHash = randomBytes(16).toString('hex'); // uniqueness is all that matters here
  const emailEncrypted = encryptEmail(email, key);
  await prisma.$executeRaw`INSERT INTO candidates (id, email_hash, email_encrypted) VALUES (${id}::uuid, ${fixtureEmailHash}, ${emailEncrypted})`;
  return id;
}
