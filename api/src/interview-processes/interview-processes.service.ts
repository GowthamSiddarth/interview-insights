import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateInterviewProcessDto } from './dto/create-interview-process.dto';

@Injectable()
export class InterviewProcessesService {
  constructor(private readonly prisma: PrismaService) {}

  create(companyId: string, candidateId: string, dto: CreateInterviewProcessDto) {
    return this.prisma.interviewProcess.create({
      data: { ...dto, companyId, candidateId },
    });
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
}
