import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { getRequiredAdminEnv } from './admin-auth.env';

export interface AdminSessionPayload {
  username: string;
}

@Injectable()
export class AdminAuthService {
  constructor(private readonly jwtService: JwtService) {}

  // Deliberately a single shared credential, not a user table — see
  // docs/ROADMAP.md Phase 18's scope note (one moderator today; revisit
  // if/when a second admin exists).
  async validateAdmin(username: unknown, password: unknown): Promise<AdminSessionPayload | null> {
    // Defensive: passport-local's guard reads req.body directly and calls
    // this before Nest's ValidationPipe ever runs on the route's @Body()
    // parameter (guards execute before pipes), so a malformed body (e.g.
    // non-string fields) must be handled here, not assumed away by the DTO.
    if (typeof username !== 'string' || typeof password !== 'string') return null;

    const expectedUsername = getRequiredAdminEnv('ADMIN_USERNAME');
    if (username !== expectedUsername) return null;

    const passwordHash = getRequiredAdminEnv('ADMIN_PASSWORD_HASH');
    const matches = await bcrypt.compare(password, passwordHash);
    return matches ? { username } : null;
  }

  issueToken(payload: AdminSessionPayload): string {
    return this.jwtService.sign(payload);
  }
}
