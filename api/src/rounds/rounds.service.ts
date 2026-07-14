import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRoundDto } from './dto/create-round.dto';

@Injectable()
export class RoundsService {
  constructor(private readonly prisma: PrismaService) {}

  create(processId: string, dto: CreateRoundDto) {
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
