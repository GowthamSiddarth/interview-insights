import { ConflictException, GoneException, Injectable, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { CandidatesService } from '../candidates/candidates.service';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { generateVerificationToken, hashVerificationToken } from './verification-token.util';

export interface CandidateSessionPayload {
  candidateId: string;
}

// Shorter than the old candidate-verification module's 24h token TTL
// (docs/DECISIONS.md) — a magic link is meant to be used almost
// immediately, not held onto; requesting a fresh one is cheap and the
// response never discloses whether the email was known either way, so a
// short expiry doesn't leak anything a longer one wouldn't.
const TOKEN_TTL_MS = 15 * 60 * 1000;

@Injectable()
export class CandidateAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly candidatesService: CandidatesService,
    private readonly mailService: MailService,
    private readonly jwtService: JwtService,
  ) {}

  // Never throws on an unknown email — the caller (controller) always
  // returns the same { status: 'ok' } shape regardless, so this endpoint
  // can't be used to enumerate which emails have an account here.
  async requestLink(email: string): Promise<void> {
    // Same upsert CandidatesService.create() already does for the public
    // POST /candidates endpoint — a returning candidate resolves back to
    // the same pseudonymous row instead of creating a duplicate.
    const candidate = await this.candidatesService.create({ email });

    const { token, tokenHash } = generateVerificationToken();
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

    await this.prisma.$transaction(async (tx) => {
      // Only the most recently requested link should be valid.
      await tx.candidateVerificationToken.updateMany({
        where: { candidateId: candidate.id, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      await tx.candidateVerificationToken.create({
        data: { candidateId: candidate.id, tokenHash, expiresAt },
      });
    });

    const verifyUrl = `${process.env.CORS_ORIGIN ?? 'http://localhost:3000'}/auth/verify?token=${token}`;
    await this.mailService.send({
      to: email,
      subject: 'Your Interview Insights login link',
      text: `Click to log in: ${verifyUrl}\n\nThis link expires in 15 minutes and can only be used once.`,
      html: `<p><a href="${verifyUrl}">Click to log in</a>.</p><p>This link expires in 15 minutes and can only be used once.</p>`,
    });
  }

  async verify(token: string): Promise<CandidateSessionPayload> {
    const tokenHash = hashVerificationToken(token);
    const record = await this.prisma.candidateVerificationToken.findUnique({
      where: { tokenHash },
    });

    if (!record) {
      throw new NotFoundException('Login link not found.');
    }
    if (record.consumedAt) {
      throw new ConflictException('This login link has already been used.');
    }
    if (record.expiresAt < new Date()) {
      throw new GoneException('This login link has expired.');
    }

    const candidate = await this.prisma.$transaction(async (tx) => {
      await tx.candidateVerificationToken.update({
        where: { id: record.id },
        data: { consumedAt: new Date() },
      });

      // A successful login is proof of email ownership — first login
      // flips verificationStatus the same way the superseded
      // candidate-verification module's separate flow used to. Only the
      // *first* login sets verifiedAt — it's a "when was this candidate
      // first verified" timestamp, not a last-login tracker, so a repeat
      // login shouldn't overwrite it.
      const existing = await tx.candidate.findUniqueOrThrow({ where: { id: record.candidateId } });
      if (existing.verificationStatus === 'email_verified') return existing;

      return tx.candidate.update({
        where: { id: record.candidateId },
        data: { verificationStatus: 'email_verified', verifiedAt: new Date() },
      });
    });

    return { candidateId: candidate.id };
  }

  issueToken(payload: CandidateSessionPayload): string {
    return this.jwtService.sign(payload);
  }
}
