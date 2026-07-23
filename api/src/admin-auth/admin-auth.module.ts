import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AdminAuthController } from './admin-auth.controller';
import { getRequiredAdminEnv } from './admin-auth.env';
import { AdminAuthService } from './admin-auth.service';
import { AdminJwtAuthGuard } from './guards/admin-jwt-auth.guard';
import { LoginThrottleGuard } from './login-throttle.guard';
import { LoginThrottleService } from './login-throttle.service';
import { AdminJwtStrategy } from './strategies/admin-jwt.strategy';
import { AdminLocalStrategy } from './strategies/admin-local.strategy';

@Module({
  imports: [
    PassportModule,
    // Reads ADMIN_JWT_SECRET at module-init (app boot) time — same timing
    // as AdminJwtStrategy's own super() call below, both fail fast on
    // startup if the secret is unset rather than lazily on first request.
    JwtModule.register({
      secret: getRequiredAdminEnv('ADMIN_JWT_SECRET'),
      signOptions: { expiresIn: '1h' },
    }),
  ],
  controllers: [AdminAuthController],
  providers: [
    AdminAuthService,
    AdminLocalStrategy,
    AdminJwtStrategy,
    LoginThrottleService,
    LoginThrottleGuard,
    AdminJwtAuthGuard,
  ],
  // AdminJwtAuthGuard is exported so ModerationModule can import this
  // module and reference the guard class directly in
  // ModerationController's @UseGuards().
  exports: [AdminJwtAuthGuard],
})
export class AdminAuthModule {}
