import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AdminAuthController } from './admin-auth.controller';
import { getRequiredAdminEnv } from './admin-auth.env';
import { AdminAuthService } from './admin-auth.service';
import { AdminJwtAuthGuard } from './guards/admin-jwt-auth.guard';
import { PermissionsGuard } from './guards/permissions.guard';
import { LoginThrottleGuard } from './login-throttle.guard';
import { LoginThrottleService } from './login-throttle.service';
import { StaffAuditLogService } from './staff-audit-log.service';
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
    PermissionsGuard,
    StaffAuditLogService,
  ],
  // AdminJwtAuthGuard/PermissionsGuard are exported so ModerationModule and
  // round-type-registry's module can import this module and reference both
  // guard classes directly in their controllers' @UseGuards() (GitHub issue
  // #588 applies PermissionsGuard to those routes). StaffAuditLogService is
  // exported so StaffAccountsModule (#589) can reuse the same durable-audit
  // write path AdminAuthService's own self-service password change uses.
  exports: [AdminJwtAuthGuard, PermissionsGuard, StaffAuditLogService],
})
export class AdminAuthModule {}
