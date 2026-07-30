import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  check() {
    // GIT_SHA is baked in at image build time (Dockerfile's GIT_SHA build
    // arg), same convention as api/src/health/health.controller.ts — lets a
    // deploy be confirmed by the exact commit it's running.
    return { status: 'ok', version: process.env.GIT_SHA ?? 'unknown' };
  }
}
