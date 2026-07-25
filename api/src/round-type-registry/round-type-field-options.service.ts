import { BadRequestException, Injectable } from '@nestjs/common';
import { RoundType, RoundTypeFieldOption } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ROUND_TYPE_FIELD_SCHEMA, RoundTypeFieldDef } from './round-type-field-schema';
import { CreateRoundTypeFieldOptionDto } from './dto/create-round-type-field-option.dto';
import { UpdateRoundTypeFieldOptionDto } from './dto/update-round-type-field-option.dto';

export interface RoundTypeFieldWithOptions extends RoundTypeFieldDef {
  options?: string[];
}

export type RoundTypeSchemaWithOptions = Record<
  RoundType,
  { fields: RoundTypeFieldWithOptions[] }
>;

@Injectable()
export class RoundTypeFieldOptionsService {
  constructor(private readonly prisma: PrismaService) {}

  async getActiveOptions(roundType: RoundType, fieldKey: string): Promise<string[]> {
    const rows = await this.prisma.roundTypeFieldOption.findMany({
      where: { roundType, fieldKey, isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: { value: true },
    });
    return rows.map((row) => row.value);
  }

  async getFullSchemaWithOptions(): Promise<RoundTypeSchemaWithOptions> {
    const roundTypes = Object.keys(ROUND_TYPE_FIELD_SCHEMA) as RoundType[];
    const result = {} as RoundTypeSchemaWithOptions;

    for (const roundType of roundTypes) {
      const fields = ROUND_TYPE_FIELD_SCHEMA[roundType];
      const fieldsWithOptions: RoundTypeFieldWithOptions[] = await Promise.all(
        fields.map(async (field) => {
          if (field.kind === 'text') return { ...field };
          const options = await this.getActiveOptions(roundType, field.key);
          return { ...field, options };
        }),
      );
      result[roundType] = { fields: fieldsWithOptions };
    }

    return result;
  }

  // Semantic validation of a round's type_metadata against its roundType's
  // registry entry — service-layer, not a DTO validator, matching this
  // codebase's existing pattern for business-rule checks (FraudChecksService,
  // ModerationService). CreateRoundDto's own @IsObject() only checks shape.
  async validateTypeMetadata(
    roundType: RoundType,
    typeMetadata: Record<string, unknown> | undefined,
  ): Promise<void> {
    if (!typeMetadata) return;

    const fieldDefs = ROUND_TYPE_FIELD_SCHEMA[roundType];
    const fieldsByKey = new Map(fieldDefs.map((field) => [field.key, field]));

    for (const key of Object.keys(typeMetadata)) {
      if (!fieldsByKey.has(key)) {
        throw new BadRequestException(
          `Unknown type_metadata key "${key}" for round type "${roundType}".`,
        );
      }
    }

    for (const field of fieldDefs) {
      const rawValue = typeMetadata[field.key];
      if (rawValue === undefined) continue;

      if (field.kind === 'text') {
        if (typeof rawValue !== 'string') {
          throw new BadRequestException(`"${field.key}" must be a string.`);
        }
        continue;
      }

      if (field.kind === 'controlled-single') {
        if (typeof rawValue !== 'string') {
          throw new BadRequestException(`"${field.key}" must be a string.`);
        }
        await this.assertActiveOptions(roundType, field.key, [rawValue]);
        continue;
      }

      // controlled-multi
      if (!Array.isArray(rawValue) || !rawValue.every((v) => typeof v === 'string')) {
        throw new BadRequestException(`"${field.key}" must be an array of strings.`);
      }
      await this.assertActiveOptions(roundType, field.key, rawValue);
    }
  }

  private async assertActiveOptions(
    roundType: RoundType,
    fieldKey: string,
    values: string[],
  ): Promise<void> {
    if (values.length === 0) return;
    const activeOptions = await this.getActiveOptions(roundType, fieldKey);
    const activeSet = new Set(activeOptions);
    const invalid = values.filter((value) => !activeSet.has(value));
    if (invalid.length > 0) {
      throw new BadRequestException(
        `Invalid value(s) for "${fieldKey}": ${invalid.join(', ')}.`,
      );
    }
  }

  // GitHub issue #263 (Phase 27): a fieldKey must be a real
  // controlled-single/controlled-multi field on that round type — never
  // an unknown key, and never a `text` field (those have no admin-managed
  // vocabulary at all, by design).
  private assertControlledField(roundType: RoundType, fieldKey: string): void {
    const fieldDefs = ROUND_TYPE_FIELD_SCHEMA[roundType];
    const field = fieldDefs.find((f) => f.key === fieldKey);
    if (!field) {
      throw new BadRequestException(
        `Unknown field "${fieldKey}" for round type "${roundType}".`,
      );
    }
    if (field.kind === 'text') {
      throw new BadRequestException(
        `"${fieldKey}" is a free-text field on round type "${roundType}" — it has no admin-managed vocabulary.`,
      );
    }
  }

  // Admin listing (GitHub issue #263) — every value, active and inactive,
  // unlike getActiveOptions()/getFullSchemaWithOptions() which only ever
  // surface active ones to the public read path.
  listAllOptions(roundType: RoundType): Promise<RoundTypeFieldOption[]> {
    return this.prisma.roundTypeFieldOption.findMany({
      where: { roundType },
      orderBy: [{ fieldKey: 'asc' }, { sortOrder: 'asc' }],
    });
  }

  async createOption(
    roundType: RoundType,
    dto: CreateRoundTypeFieldOptionDto,
  ): Promise<RoundTypeFieldOption> {
    this.assertControlledField(roundType, dto.fieldKey);

    let sortOrder = dto.sortOrder;
    if (sortOrder === undefined) {
      const highest = await this.prisma.roundTypeFieldOption.findFirst({
        where: { roundType, fieldKey: dto.fieldKey },
        orderBy: { sortOrder: 'desc' },
        select: { sortOrder: true },
      });
      sortOrder = (highest?.sortOrder ?? -1) + 1;
    }

    // A duplicate (roundType, fieldKey, value) surfaces as a 409 via the
    // global PrismaExceptionFilter (P2002) — no app-level check needed.
    return this.prisma.roundTypeFieldOption.create({
      data: { roundType, fieldKey: dto.fieldKey, value: dto.value, sortOrder },
    });
  }

  // A missing id surfaces as a 404 via the global PrismaExceptionFilter
  // (P2025) — no app-level existence check needed.
  updateOption(id: string, dto: UpdateRoundTypeFieldOptionDto): Promise<RoundTypeFieldOption> {
    return this.prisma.roundTypeFieldOption.update({ where: { id }, data: dto });
  }
}
