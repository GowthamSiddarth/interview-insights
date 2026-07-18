import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';
import { PrismaService } from '../prisma/prisma.service';

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: PrismaService,
          useValue: { $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) },
        },
      ],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  it('reports ok when the database responds', async () => {
    await expect(controller.check()).resolves.toEqual({ status: 'ok', version: 'unknown' });
  });

  it('reports the deployed commit when GIT_SHA is set', async () => {
    const original = process.env.GIT_SHA;
    process.env.GIT_SHA = 'abc1234';
    try {
      await expect(controller.check()).resolves.toEqual({ status: 'ok', version: 'abc1234' });
    } finally {
      process.env.GIT_SHA = original;
    }
  });
});
