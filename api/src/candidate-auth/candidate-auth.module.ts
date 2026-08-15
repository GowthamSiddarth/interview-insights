import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { CandidatesModule } from '../candidates/candidates.module';
import { MailModule } from '../mail/mail.module';
import { getRequiredCandidateJwtSecret } from './candidate-auth.env';
import { CandidateAuthController } from './candidate-auth.controller';
import { CandidateAuthService } from './candidate-auth.service';
import { CandidateLoginThrottleGuard } from './candidate-login-throttle.guard';
import { CandidateLoginThrottleService } from './candidate-login-throttle.service';
import { CandidateJwtAuthGuard } from './guards/candidate-jwt-auth.guard';
import { MagicLinkThrottleGuard } from './magic-link-throttle.guard';
import { MagicLinkThrottleService } from './magic-link-throttle.service';
import { PasswordResetThrottleGuard } from './password-reset-throttle.guard';
import { PasswordResetThrottleService } from './password-reset-throttle.service';
import { CandidateJwtStrategy } from './strategies/candidate-jwt.strategy';

@Module({
  imports: [
    CandidatesModule,
    MailModule,
    PassportModule,
    // Reads CANDIDATE_JWT_SECRET at module-init (app boot) time — same
    // timing as CandidateJwtStrategy's own super() call, both fail fast
    // on startup if the secret is unset. A distinct secret from
    // ADMIN_JWT_SECRET — compromising one session type shouldn't let
    // anyone forge the other.
    JwtModule.register({
      secret: getRequiredCandidateJwtSecret(),
      signOptions: { expiresIn: '1h' },
    }),
  ],
  controllers: [CandidateAuthController],
  providers: [
    CandidateAuthService,
    CandidateJwtStrategy,
    MagicLinkThrottleService,
    MagicLinkThrottleGuard,
    CandidateLoginThrottleService,
    CandidateLoginThrottleGuard,
    PasswordResetThrottleService,
    PasswordResetThrottleGuard,
    CandidateJwtAuthGuard,
  ],
  // CandidateJwtAuthGuard is exported so issue #146's write-path modules
  // can import this module and reference the guard directly, same
  // pattern as AdminJwtAuthGuard/ModerationModule.
  exports: [CandidateJwtAuthGuard],
})
export class CandidateAuthModule {}
