import { PrismaService } from './prisma.service';

// GitHub issue #831 (Phase 57) — a thin wrapper, so this just asserts the
// one behavior it actually adds over a bare PrismaClient: connecting/
// disconnecting on the Nest module lifecycle hooks.
describe('PrismaService', () => {
  it('connects on module init', async () => {
    const service = new PrismaService();
    const connectSpy = jest.spyOn(service, '$connect').mockResolvedValue(undefined);

    await service.onModuleInit();

    expect(connectSpy).toHaveBeenCalled();
  });

  it('disconnects on module destroy', async () => {
    const service = new PrismaService();
    const disconnectSpy = jest.spyOn(service, '$disconnect').mockResolvedValue(undefined);

    await service.onModuleDestroy();

    expect(disconnectSpy).toHaveBeenCalled();
  });
});
