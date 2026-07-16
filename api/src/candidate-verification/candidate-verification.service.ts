import { ConflictException, GoneException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { generateVerificationToken, hashVerificationToken } from './verification-token.util';

// Placeholder, not tuned against real data — same spirit as the other
// window/threshold constants in this codebase (e.g. FraudChecksService).
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

// Never return email_hash — mirrors CandidatesService's response shaping.
function toCandidateResponse(candidate: {
  id: string;
  verificationStatus: string;
  verifiedAt: Date | null;
  createdAt: Date;
}) {
  const { id, verificationStatus, verifiedAt, createdAt } = candidate;
  return { id, verificationStatus, verifiedAt, createdAt };
}

@Injectable()
export class CandidateVerificationService {
  constructor(private readonly prisma: PrismaService) {}

  async issueToken(candidateId: string) {
    const { token, tokenHash } = generateVerificationToken();
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

    await this.prisma.$transaction(async (tx) => {
      // Only the most recently issued token should be valid.
      await tx.candidateVerificationToken.updateMany({
        where: { candidateId, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      await tx.candidateVerificationToken.create({
        data: { candidateId, tokenHash, expiresAt },
      });
    });

    // Only time the raw token is ever available. There's no email delivery
    // yet (docs/ROADMAP.md Phase 3 issue #3 MVP scope), so it's returned
    // directly instead of emailed — a future email-sending integration
    // would replace this return value with "sent", not the token itself.
    return { token, expiresAt };
  }

  async verify(token: string) {
    const tokenHash = hashVerificationToken(token);
    const record = await this.prisma.candidateVerificationToken.findUnique({
      where: { tokenHash },
    });

    if (!record) {
      throw new NotFoundException('Verification token not found.');
    }
    if (record.consumedAt) {
      throw new ConflictException('This verification token has already been used.');
    }
    if (record.expiresAt < new Date()) {
      throw new GoneException('This verification token has expired.');
    }

    const candidate = await this.prisma.$transaction(async (tx) => {
      await tx.candidateVerificationToken.update({
        where: { id: record.id },
        data: { consumedAt: new Date() },
      });
      return tx.candidate.update({
        where: { id: record.candidateId },
        data: { verificationStatus: 'email_verified', verifiedAt: new Date() },
      });
    });

    return toCandidateResponse(candidate);
  }
}
