import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCandidateDto } from './dto/create-candidate.dto';
import { hashEmail } from './email-hash.util';

function getEmailHashSecret(): string {
  const secret = process.env.EMAIL_HASH_SECRET;
  if (!secret) {
    throw new Error('EMAIL_HASH_SECRET must be set to hash candidate emails.');
  }
  return secret;
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
    const candidate = await this.prisma.candidate.upsert({
      where: { emailHash },
      create: { emailHash },
      update: {},
    });
    return toResponse(candidate);
  }

  async findOne(id: string) {
    const candidate = await this.prisma.candidate.findUniqueOrThrow({ where: { id } });
    return toResponse(candidate);
  }
}
