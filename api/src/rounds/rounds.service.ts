import { Injectable } from '@nestjs/common';
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

  async create(processId: string, dto: CreateRoundDto) {
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
