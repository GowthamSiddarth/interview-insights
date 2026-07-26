import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateInterviewProcessDto } from './dto/create-interview-process.dto';

@Injectable()
export class InterviewProcessesService {
  constructor(private readonly prisma: PrismaService) {}

  // GitHub issue #369 (Phase 35) — a company creation request that's
  // still pending (or was rejected) doesn't publicly exist yet; writing
  // real review data against it would let that data leak the company's
  // existence before a moderator ever approves it.
  async create(companyId: string, candidateId: string, dto: CreateInterviewProcessDto) {
    await this.assertCompanyApproved(companyId);
    return this.prisma.interviewProcess.create({
      data: { ...dto, companyId, candidateId },
    });
  }

  private async assertCompanyApproved(companyId: string): Promise<void> {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { status: true },
    });
    if (!company || company.status !== 'approved') {
      throw new NotFoundException('Company not found.');
    }
  }

  findAllForCompany(companyId: string) {
    return this.prisma.interviewProcess.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
    });
  }

  findOne(id: string) {
    return this.prisma.interviewProcess.findUniqueOrThrow({
      where: { id },
      include: { rounds: { orderBy: { sequenceNumber: 'asc' } } },
    });
  }

  // GitHub issue #260 — deliberately narrower than it looks: this is not
  // a general "delete my process" (issue #150 explicitly kept structural
  // entities out of scope, since there's no moderation status to
  // protect there). This only ever deletes a process with genuinely
  // nothing in it — no rating/review in ANY status, pending included,
  // since even an unmoderated pending rating is real content to lose.
  // No moderation_queue cleanup needed: an empty process never enqueued
  // anything (docs/DATA_MODEL.md — queue rows only ever exist per
  // rating/review, never per structural entity).
  async remove(id: string, candidateId: string): Promise<void> {
    const process = await this.prisma.interviewProcess.findUniqueOrThrow({
      where: { id },
      include: {
        rounds: { include: { ratings: true } },
        recruiterInteractions: { include: { ratings: true } },
        overallReview: true,
      },
    });
    if (process.candidateId !== candidateId) {
      throw new ForbiddenException('You can only delete your own process.');
    }

    const hasAnyContent =
      process.rounds.some((r) => r.ratings.length > 0) ||
      process.recruiterInteractions.some((ri) => ri.ratings.length > 0) ||
      process.overallReview !== null;
    if (hasAnyContent) {
      throw new ConflictException(
        'This process has at least one rating or review and cannot be deleted.',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.round.deleteMany({ where: { processId: id } });
      await tx.recruiterInteraction.deleteMany({ where: { processId: id } });
      await tx.interviewProcess.delete({ where: { id } });
    });
  }
}
