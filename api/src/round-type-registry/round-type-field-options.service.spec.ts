import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { RoundTypeFieldOptionsService } from './round-type-field-options.service';
import { PrismaService } from '../prisma/prisma.service';

describe('RoundTypeFieldOptionsService', () => {
  let service: RoundTypeFieldOptionsService;
  let prisma: { roundTypeFieldOption: { findMany: jest.Mock } };

  beforeEach(async () => {
    prisma = {
      roundTypeFieldOption: {
        findMany: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoundTypeFieldOptionsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(RoundTypeFieldOptionsService);
  });

  describe('getActiveOptions', () => {
    it('returns active option values in sortOrder', async () => {
      prisma.roundTypeFieldOption.findMany.mockResolvedValue([
        { value: 'DFS' },
        { value: 'BFS' },
      ]);

      await expect(service.getActiveOptions('coding', 'problemAlgorithms')).resolves.toEqual([
        'DFS',
        'BFS',
      ]);
      expect(prisma.roundTypeFieldOption.findMany).toHaveBeenCalledWith({
        where: { roundType: 'coding', fieldKey: 'problemAlgorithms', isActive: true },
        orderBy: { sortOrder: 'asc' },
        select: { value: true },
      });
    });
  });

  describe('getFullSchemaWithOptions', () => {
    it('includes options only for controlled fields, not text fields', async () => {
      prisma.roundTypeFieldOption.findMany.mockResolvedValue([{ value: 'DFS' }]);

      const schema = await service.getFullSchemaWithOptions();

      const codingProblemAlgorithms = schema.coding.fields.find(
        (f) => f.key === 'problemAlgorithms',
      );
      const codingProblemDescription = schema.coding.fields.find(
        (f) => f.key === 'problemDescription',
      );
      expect(codingProblemAlgorithms?.options).toEqual(['DFS']);
      expect(codingProblemDescription?.options).toBeUndefined();
    });

    it('gives `other` only its free-text notes field, with no controlled fields', async () => {
      prisma.roundTypeFieldOption.findMany.mockResolvedValue([]);
      const schema = await service.getFullSchemaWithOptions();
      expect(schema.other.fields).toEqual([{ key: 'notes', kind: 'text' }]);
    });
  });

  describe('validateTypeMetadata', () => {
    it('does nothing when typeMetadata is undefined', async () => {
      await expect(
        service.validateTypeMetadata('coding', undefined),
      ).resolves.toBeUndefined();
      expect(prisma.roundTypeFieldOption.findMany).not.toHaveBeenCalled();
    });

    it('rejects an unknown key for the given round type', async () => {
      await expect(
        service.validateTypeMetadata('coding', { notAField: 'x' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a non-string value for a text field', async () => {
      await expect(
        service.validateTypeMetadata('coding', { problemDescription: 123 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts a valid text field', async () => {
      await expect(
        service.validateTypeMetadata('coding', { problemDescription: 'two-sum variant' }),
      ).resolves.toBeUndefined();
    });

    it('rejects a controlled-single value not currently active', async () => {
      prisma.roundTypeFieldOption.findMany.mockResolvedValue([{ value: 'STAR' }]);

      await expect(
        service.validateTypeMetadata('behavioral', { frameworkUsed: 'NOT_REAL' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts a controlled-single value that is currently active', async () => {
      prisma.roundTypeFieldOption.findMany.mockResolvedValue([{ value: 'STAR' }]);

      await expect(
        service.validateTypeMetadata('behavioral', { frameworkUsed: 'STAR' }),
      ).resolves.toBeUndefined();
    });

    it('rejects a controlled-multi field that is not an array', async () => {
      await expect(
        service.validateTypeMetadata('coding', { problemAlgorithms: 'DFS' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a controlled-multi value containing an inactive/unknown option', async () => {
      prisma.roundTypeFieldOption.findMany.mockResolvedValue([{ value: 'DFS' }]);

      await expect(
        service.validateTypeMetadata('coding', { problemAlgorithms: ['DFS', 'MADE_UP'] }),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts a controlled-multi field where every value is active', async () => {
      prisma.roundTypeFieldOption.findMany.mockResolvedValue([
        { value: 'DFS' },
        { value: 'BFS' },
      ]);

      await expect(
        service.validateTypeMetadata('coding', { problemAlgorithms: ['DFS', 'BFS'] }),
      ).resolves.toBeUndefined();
    });

    it('accepts `other` with only its free-text notes field', async () => {
      await expect(
        service.validateTypeMetadata('other', { notes: 'unusual format, no fixed script' }),
      ).resolves.toBeUndefined();
    });

    it('rejects `other` given a controlled-style key it does not define', async () => {
      await expect(
        service.validateTypeMetadata('other', { problemAlgorithms: ['DFS'] }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
