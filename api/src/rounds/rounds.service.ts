import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RoundTypeFieldOptionsService } from '../round-type-registry/round-type-field-options.service';
import { CreateRoundDto } from './dto/create-round.dto';

@Injectable()
export class RoundsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly roundTypeFieldOptionsService: RoundTypeFieldOptionsService,
  ) {}

  // GitHub issue #775 — ownership checked before validation so an
  // unauthorized caller learns nothing about type_metadata rules.
  async create(processId: string, candidateId: string, dto: CreateRoundDto) {
    const process = await this.prisma.interviewProcess.findUniqueOrThrow({
      where: { id: processId },
      select: { candidateId: true },
    });
    if (process.candidateId !== candidateId) {
      throw new ForbiddenException('You can only add rounds to your own process.');
    }

    await this.roundTypeFieldOptionsService.validateTypeMetadata(
      dto.roundType,
      dto.typeMetadata,
    );

    return this.prisma.round.create({
      data: {
        ...dto,
        processId,
        typeMetadata: dto.typeMetadata as Prisma.InputJsonValue | undefined,
      },
    });
  }

  findAllForProcess(processId: string) {
    return this.prisma.round.findMany({
      where: { processId },
      orderBy: { sequenceNumber: 'asc' },
    });
  }
}
