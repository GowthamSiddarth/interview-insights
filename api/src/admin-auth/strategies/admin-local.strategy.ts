import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-local';
import { AdminAuthService } from '../admin-auth.service';

// Named 'admin-local' (not passport's default 'local') so it can't be
// confused with any future candidate-facing local strategy.
@Injectable()
export class AdminLocalStrategy extends PassportStrategy(Strategy, 'admin-local') {
  constructor(private readonly adminAuthService: AdminAuthService) {
    super();
  }

  async validate(username: string, password: string) {
    const admin = await this.adminAuthService.validateAdmin(username, password);
    if (!admin) {
      throw new UnauthorizedException('Invalid admin credentials.');
    }
    return admin;
  }
}
