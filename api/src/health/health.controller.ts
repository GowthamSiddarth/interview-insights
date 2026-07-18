import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check() {
    await this.prisma.$queryRaw`SELECT 1`;
    // GIT_SHA is baked in at image build time (api/Dockerfile's GIT_SHA
    // build arg) — lets a deploy be confirmed by the exact commit it's
    // running, not just "the rollout reported success" (GitHub issue #89).
    return { status: 'ok', version: process.env.GIT_SHA ?? 'unknown' };
  }
}
