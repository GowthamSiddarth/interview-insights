import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { RoundsService } from './rounds.service';
import { PrismaService } from '../prisma/prisma.service';
import { RoundTypeFieldOptionsService } from '../round-type-registry/round-type-field-options.service';

describe('RoundsService', () => {
  let service: RoundsService;
  let prisma: { round: { create: jest.Mock; findMany: jest.Mock } };
  let fieldOptionsService: { validateTypeMetadata: jest.Mock };

  beforeEach(async () => {
    prisma = {
      round: {
        create: jest.fn(),
        findMany: jest.fn(),
      },
    };
    fieldOptionsService = {
      validateTypeMetadata: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoundsService,
        { provide: PrismaService, useValue: prisma },
        { provide: RoundTypeFieldOptionsService, useValue: fieldOptionsService },
      ],
    }).compile();

    service = module.get(RoundsService);
  });

  describe('create', () => {
    const dto = {
      sequenceNumber: 1,
      title: 'Technical Screen',
      roundType: 'coding' as const,
      typeMetadata: { problemAlgorithms: ['DFS'] },
    };

    it('validates type_metadata against the registry before writing', async () => {
      prisma.round.create.mockResolvedValue({ id: 'round-1', ...dto });

      await service.create('process-1', dto);

      expect(fieldOptionsService.validateTypeMetadata).toHaveBeenCalledWith(
        'coding',
        dto.typeMetadata,
      );
      expect(prisma.round.create).toHaveBeenCalled();
    });

    it('never writes to the database when validation rejects the metadata', async () => {
      fieldOptionsService.validateTypeMetadata.mockRejectedValue(
        new BadRequestException('Invalid value(s)'),
      );

      await expect(service.create('process-1', dto)).rejects.toThrow(BadRequestException);
      expect(prisma.round.create).not.toHaveBeenCalled();
    });
  });
});
