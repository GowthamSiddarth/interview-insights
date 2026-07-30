import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();

    controller = module.get(HealthController);
  });

  it('reports ok status', () => {
    expect(controller.check()).toEqual({ status: 'ok', version: 'unknown' });
  });

  it('surfaces GIT_SHA when baked into the image', () => {
    process.env.GIT_SHA = 'abc1234';
    expect(controller.check()).toEqual({ status: 'ok', version: 'abc1234' });
    delete process.env.GIT_SHA;
  });
});
