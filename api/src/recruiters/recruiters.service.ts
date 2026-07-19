import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { hashRecruiterIdentifier } from './recruiter-identifier-hash.util';

type PrismaTransaction = Prisma.TransactionClient;

function getRecruiterIdentifierHashSecret(): string {
  const secret = process.env.EMAIL_HASH_SECRET;
  if (!secret) {
    throw new Error('EMAIL_HASH_SECRET must be set to hash recruiter identifiers.');
  }
  return secret;
}

function labelForIndex(index: number): string {
  return `Recruiter ${String.fromCharCode(65 + index)}`;
}

// Recruiters are never created directly by a client — only resolved as a
// side effect of submitting a RecruiterInteraction, the same "upsert by
// hashed identity" shape CandidatesService already uses. Never stores or
// returns the raw identifier, only its hash + a generated label (CLAUDE.md
// hard constraint #1: never expose a real recruiter name publicly).
@Injectable()
export class RecruitersService {
  constructor(private readonly prisma: PrismaService) {}

  async findOrCreate(companyId: string, identifier: string, tx: PrismaTransaction = this.prisma) {
    const internalIdentifierHash = hashRecruiterIdentifier(
      identifier,
      getRecruiterIdentifierHashSecret(),
    );

    const existing = await tx.recruiter.findUnique({
      where: { companyId_internalIdentifierHash: { companyId, internalIdentifierHash } },
    });
    if (existing) return existing;

    // Sequential per-company label ("Recruiter A", "Recruiter B", ...) — the
    // same generated-label idea docs/DATA_MODEL.md describes for
    // Interviewer, just company- rather than process-scoped, since a
    // RecruiterInteraction isn't tied to any one round.
    const priorCount = await tx.recruiter.count({ where: { companyId } });
    return tx.recruiter.create({
      data: { companyId, internalIdentifierHash, displayLabel: labelForIndex(priorCount) },
    });
  }
}
