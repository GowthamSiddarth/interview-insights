import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

// Mirrors services/notification-service/src/prisma/prisma.service.ts exactly
// — same "let Nest own the connection lifecycle" reasoning, just against
// this service's own generated client (docs/DECISIONS.md D75/D81).
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
