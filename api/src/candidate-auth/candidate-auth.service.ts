import { ConflictException, GoneException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { CandidatesService } from '../candidates/candidates.service';
import { getEmailHashSecret, getEmailEncryptionKey } from '../candidates/candidates.service';
import { encryptEmail } from '../candidates/email-encryption.util';
import { hashEmail } from '../candidates/email-hash.util';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { generateVerificationToken, hashVerificationToken } from './verification-token.util';

// GitHub issue #679 (Phase 48, D104) — tokenVersion rides along on every
// session so CandidateJwtStrategy can invalidate every JWT issued before
// a password change/reset (#682 bumps this column) by re-checking it on
// every request, same "re-check on every request rather than trust the
// token's own claims" pattern AdminJwtStrategy already uses for
// isActive/role.
export interface CandidateSessionPayload {
  candidateId: string;
  tokenVersion: number;
}

// Shorter than the old candidate-verification module's 24h token TTL
// (docs/DECISIONS.md) — a magic link is meant to be used almost
// immediately, not held onto; requesting a fresh one is cheap and the
// response never discloses whether the email was known either way, so a
// short expiry doesn't leak anything a longer one wouldn't.
const TOKEN_TTL_MS = 15 * 60 * 1000;

// Matches AdminAuthService's own cost factor (admin-auth.service.ts) —
// no reason for candidate password hashing to be cheaper or more
// expensive than staff's.
const BCRYPT_COST = 10;

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
    await this.issueAndSendVerificationEmail(candidate.id, email, 'login');
  }

  // GitHub issue #680 (Phase 48, D104) — candidates were the only actor
  // still on magic-link-only auth; this brings them to parity with
  // admin-auth's password pattern. Attaches a password to the same
  // pseudonymous candidate row emailHash already resolves to (a
  // candidate who previously only ever used the magic link gets one
  // added, not a duplicate account) — rejected outright if a password is
  // already set, so this can't be used to silently take over an existing
  // password-protected account by re-registering its email.
  async register(email: string, password: string): Promise<CandidateSessionPayload> {
    const emailHash = hashEmail(email, getEmailHashSecret());
    const existing = await this.prisma.candidate.findUnique({ where: { emailHash } });
    if (existing?.passwordHash) {
      throw new ConflictException('An account with this email already has a password set.');
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
    const emailEncrypted = encryptEmail(email, getEmailEncryptionKey());
    const passwordSetAt = new Date();
    const candidate = await this.prisma.candidate.upsert({
      where: { emailHash },
      create: { emailHash, emailEncrypted, passwordHash, passwordSetAt },
      update: { emailEncrypted, passwordHash, passwordSetAt },
    });

    // Best-effort, same as every other outbound mail in this class — a
    // failed send here shouldn't undo the account/password that was just
    // durably created; the candidate can always request a fresh link.
    await this.issueAndSendVerificationEmail(candidate.id, email, 'verify').catch(() => undefined);

    return { candidateId: candidate.id, tokenVersion: candidate.tokenVersion };
  }

  // GitHub issue #681 (Phase 48, D104) — password login, parity with
  // AdminAuthService.validateAdmin(). Returns null-ish via throwing
  // UnauthorizedException for both "no such email" and "wrong password"
  // (and "no password ever set" — a magic-link-only candidate) — the
  // same message for all three so this can't be used to enumerate
  // registered emails.
  async login(email: string, password: string): Promise<CandidateSessionPayload> {
    const emailHash = hashEmail(email, getEmailHashSecret());
    const candidate = await this.prisma.candidate.findUnique({ where: { emailHash } });
    if (!candidate?.passwordHash) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    const matches = await bcrypt.compare(password, candidate.passwordHash);
    if (!matches) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    return { candidateId: candidate.id, tokenVersion: candidate.tokenVersion };
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

    return { candidateId: candidate.id, tokenVersion: candidate.tokenVersion };
  }

  // GitHub issue #682 (Phase 48, D104) — forgot-password flow, first
  // half. Never throws on an unknown email, same enumeration-safety
  // reasoning as requestLink() — the controller returns the same
  // { status: 'ok' } either way. Works even for a candidate who has
  // never set a password (magic-link-only) — completing the flow just
  // means they now have one, same as register() attaching a password to
  // an existing account.
  async requestPasswordReset(email: string): Promise<void> {
    const emailHash = hashEmail(email, getEmailHashSecret());
    const candidate = await this.prisma.candidate.findUnique({ where: { emailHash } });
    if (!candidate) return;

    const { token, tokenHash } = generateVerificationToken();
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

    await this.prisma.$transaction(async (tx) => {
      // Only the most recently requested reset should be valid.
      await tx.candidatePasswordResetToken.updateMany({
        where: { candidateId: candidate.id, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      await tx.candidatePasswordResetToken.create({
        data: { candidateId: candidate.id, tokenHash, expiresAt },
      });
    });

    const resetUrl = `${process.env.CORS_ORIGIN ?? 'http://localhost:3000'}/auth/reset-password?token=${token}`;
    await this.mailService.send({
      to: email,
      subject: 'Reset your Interview Insights password',
      text: `Click to choose a new password: ${resetUrl}\n\nThis link expires in 15 minutes and can only be used once. If you didn't request this, you can safely ignore this email.`,
      html: `<p><a href="${resetUrl}">Click to choose a new password</a>.</p><p>This link expires in 15 minutes and can only be used once. If you didn't request this, you can safely ignore this email.</p>`,
    });
  }

  // GitHub issue #682, second half. Bumps tokenVersion — the whole point
  // of that column (see CandidateSessionPayload's own comment above) —
  // so every session issued before this reset is invalidated on its very
  // next request, not just the password itself changing. Auto-issues a
  // fresh session on success, same as register()/verify(): the candidate
  // just proved control of the token *and* chose a valid new password.
  async confirmPasswordReset(token: string, newPassword: string): Promise<CandidateSessionPayload> {
    const tokenHash = hashVerificationToken(token);
    const record = await this.prisma.candidatePasswordResetToken.findUnique({ where: { tokenHash } });

    if (!record) {
      throw new NotFoundException('Password reset link not found.');
    }
    if (record.consumedAt) {
      throw new ConflictException('This password reset link has already been used.');
    }
    if (record.expiresAt < new Date()) {
      throw new GoneException('This password reset link has expired.');
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);
    const candidate = await this.prisma.$transaction(async (tx) => {
      await tx.candidatePasswordResetToken.update({
        where: { id: record.id },
        data: { consumedAt: new Date() },
      });
      return tx.candidate.update({
        where: { id: record.candidateId },
        data: { passwordHash, passwordSetAt: new Date(), tokenVersion: { increment: 1 } },
      });
    });

    return { candidateId: candidate.id, tokenVersion: candidate.tokenVersion };
  }

  issueToken(payload: CandidateSessionPayload): string {
    return this.jwtService.sign(payload);
  }

  // Shared by requestLink() (a login link) and register() (an email-
  // ownership confirmation) — same token table, same consume-on-verify
  // path (verify() above), only the outbound copy differs.
  private async issueAndSendVerificationEmail(
    candidateId: string,
    email: string,
    purpose: 'login' | 'verify',
  ): Promise<void> {
    const { token, tokenHash } = generateVerificationToken();
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

    await this.prisma.$transaction(async (tx) => {
      // Only the most recently requested link should be valid.
      await tx.candidateVerificationToken.updateMany({
        where: { candidateId, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      await tx.candidateVerificationToken.create({
        data: { candidateId, tokenHash, expiresAt },
      });
    });

    const verifyUrl = `${process.env.CORS_ORIGIN ?? 'http://localhost:3000'}/auth/verify?token=${token}`;
    const subject = purpose === 'login' ? 'Your Interview Insights login link' : 'Verify your Interview Insights email';
    const action = purpose === 'login' ? 'log in' : 'verify your email';
    await this.mailService.send({
      to: email,
      subject,
      text: `Click to ${action}: ${verifyUrl}\n\nThis link expires in 15 minutes and can only be used once.`,
      html: `<p><a href="${verifyUrl}">Click to ${action}</a>.</p><p>This link expires in 15 minutes and can only be used once.</p>`,
    });
  }
}
