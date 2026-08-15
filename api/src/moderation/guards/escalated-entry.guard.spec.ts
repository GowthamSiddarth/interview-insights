import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { EscalatedEntryGuard } from './escalated-entry.guard';

function contextFor(id: string, role: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ params: { id }, user: { id: 'mod-1', username: 'someone', role } }),
    }),
  } as unknown as ExecutionContext;
}

// GitHub issue #689 (Phase 49, D104).
describe('EscalatedEntryGuard', () => {
  let prisma: { moderationQueueEntry: { findUnique: jest.Mock } };

  beforeEach(() => {
    prisma = { moderationQueueEntry: { findUnique: jest.fn() } };
  });

  function buildGuard(): EscalatedEntryGuard {
    return new EscalatedEntryGuard(prisma as unknown as PrismaService);
  }

  it('allows a non-escalated entry through for any role with route access', async () => {
    prisma.moderationQueueEntry.findUnique.mockResolvedValue({ escalated: false });
    const guard = buildGuard();

    await expect(guard.canActivate(contextFor('queue-1', 'moderator'))).resolves.toBe(true);
  });

  it('allows an escalated entry through for an admin', async () => {
    prisma.moderationQueueEntry.findUnique.mockResolvedValue({ escalated: true });
    const guard = buildGuard();

    await expect(guard.canActivate(contextFor('queue-1', 'admin'))).resolves.toBe(true);
  });

  it('throws ForbiddenException for a moderator hitting an escalated entry', async () => {
    prisma.moderationQueueEntry.findUnique.mockResolvedValue({ escalated: true });
    const guard = buildGuard();

    await expect(guard.canActivate(contextFor('queue-1', 'moderator'))).rejects.toThrow(ForbiddenException);
  });

  it('looks the entry up by the route id, selecting only escalated', async () => {
    prisma.moderationQueueEntry.findUnique.mockResolvedValue({ escalated: false });
    const guard = buildGuard();

    await guard.canActivate(contextFor('queue-1', 'moderator'));

    expect(prisma.moderationQueueEntry.findUnique).toHaveBeenCalledWith({
      where: { id: 'queue-1' },
      select: { escalated: true },
    });
  });

  it('lets a missing entry through — the service layer reports its own 404', async () => {
    prisma.moderationQueueEntry.findUnique.mockResolvedValue(null);
    const guard = buildGuard();

    await expect(guard.canActivate(contextFor('nonexistent', 'moderator'))).resolves.toBe(true);
  });
});
