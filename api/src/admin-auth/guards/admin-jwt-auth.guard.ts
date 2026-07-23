import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

// Applied at the controller level on ModerationController — every route
// (list/approve/reject/flag) 401s without a valid admin_session cookie.
// AuthGuard's default handleRequest already throws UnauthorizedException
// on missing/invalid/expired tokens, so no override needed here.
@Injectable()
export class AdminJwtAuthGuard extends AuthGuard('admin-jwt') {}
