import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { AdminSessionPayload } from '../../admin-auth/admin-auth.service';
import { PrismaService } from '../../prisma/prisma.service';

// GitHub issue #689 (Phase 49, D104) — lifetime resubmission cap:
// ModerationService.reenqueue() sets moderation_queue.escalated once a
// resubmission crosses the cap. Must run after AdminJwtAuthGuard in the
// same @UseGuards() array — reads req.user, same precondition
// PermissionsGuard already documents. Deliberately a guard, not a check
// inside ModerationService.review() itself — keeps "who may resolve an
// escalated entry" a routing-layer policy (same layer PermissionsGuard's
// base moderator-vs-staff check already lives at) rather than adding an
// actor-role parameter to review()'s signature for every caller
// (including the system-attributed AI auto-approval path, which
// VerdictConsumerService already excludes before ever reaching this
// controller — see its own check).
@Injectable()
export class EscalatedEntryGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const id = req.params.id as string;

    // A missing entry isn't this guard's problem to report — let the
    // service's own findUniqueOrThrow produce its usual 404 downstream.
    const entry = await this.prisma.moderationQueueEntry.findUnique({
      where: { id },
      select: { escalated: true },
    });
    if (!entry?.escalated) return true;

    const { role } = req.user as AdminSessionPayload;
    if (role !== 'admin') {
      throw new ForbiddenException(
        'This item has been escalated after repeated resubmissions and requires admin review.',
      );
    }
    return true;
  }
}
