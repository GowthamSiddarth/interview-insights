import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCandidateDto } from './dto/create-candidate.dto';
import { hashEmail } from './email-hash.util';
import { encryptEmail } from './email-encryption.util';

// Exported so CandidateAuthService (GitHub issue #680, Phase 48) can hash
// an email to the same emailHash this service upserts candidates by,
// without duplicating the env-var-read logic.
export function getEmailHashSecret(): string {
  const secret = process.env.EMAIL_HASH_SECRET;
  if (!secret) {
    throw new Error('EMAIL_HASH_SECRET must be set to hash candidate emails.');
  }
  return secret;
}

// GitHub issue #335, D74 — distinct from EMAIL_HASH_SECRET on purpose;
// see email-encryption.util.ts's own comment.
export function getEmailEncryptionKey(): string {
  const key = process.env.EMAIL_ENCRYPTION_KEY;
  if (!key) {
    throw new Error('EMAIL_ENCRYPTION_KEY must be set to store a candidate email notification-service can use.');
  }
  return key;
}

// Never return email_hash from the API — it's for de-duplication only.
function toResponse(candidate: {
  id: string;
  verificationStatus: string;
  verifiedAt: Date | null;
  createdAt: Date;
}) {
  const { id, verificationStatus, verifiedAt, createdAt } = candidate;
  return { id, verificationStatus, verifiedAt, createdAt };
}

@Injectable()
export class CandidatesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateCandidateDto) {
    // Upsert, not create: there's no login/session system yet, so email is
    // the only way a returning candidate resolves back to the same
    // pseudonymous candidate row instead of getting a 409 on every repeat visit.
    const emailHash = hashEmail(dto.email, getEmailHashSecret());
    // Re-derived (and re-written via `update` below) on every call, not
    // just at first creation — self-heals emailEncrypted for any row
    // written before this column existed, the same "next natural touch
    // fixes it" pattern D61/D69 already use elsewhere in this codebase,
    // without needing a dedicated backfill script.
    const emailEncrypted = encryptEmail(dto.email, getEmailEncryptionKey());
    const candidate = await this.prisma.candidate.upsert({
      where: { emailHash },
      create: { emailHash, emailEncrypted },
      update: { emailEncrypted },
    });
    return toResponse(candidate);
  }

  async findOne(id: string) {
    const candidate = await this.prisma.candidate.findUniqueOrThrow({ where: { id } });
    return toResponse(candidate);
  }
}
