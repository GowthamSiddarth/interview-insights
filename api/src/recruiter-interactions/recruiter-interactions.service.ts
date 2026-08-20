import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RecruitersService } from '../recruiters/recruiters.service';
import { CreateRecruiterInteractionDto } from './dto/create-recruiter-interaction.dto';

@Injectable()
export class RecruiterInteractionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly recruitersService: RecruitersService,
  ) {}

  // A single transaction: resolving/creating the Recruiter and creating the
  // RecruiterInteraction that references it must succeed or fail together,
  // same reasoning as every other write path in this app.
  // GitHub issue #776 — ownership checked before findOrCreate so an
  // unauthorized caller can't mint Recruiter rows either.
  create(processId: string, candidateId: string, dto: CreateRecruiterInteractionDto) {
    return this.prisma.$transaction(async (tx) => {
      const process = await tx.interviewProcess.findUniqueOrThrow({
        where: { id: processId },
        select: { companyId: true, candidateId: true },
      });
      if (process.candidateId !== candidateId) {
        throw new ForbiddenException('You can only add recruiter interactions to your own process.');
      }
      const recruiter = await this.recruitersService.findOrCreate(
        process.companyId,
        dto.recruiterIdentifier,
        tx,
      );
      return tx.recruiterInteraction.create({
        data: { processId, recruiterId: recruiter.id },
      });
    });
  }
}