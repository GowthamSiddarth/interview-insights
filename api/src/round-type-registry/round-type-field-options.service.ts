import { BadRequestException, Injectable } from '@nestjs/common';
import { RoundType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ROUND_TYPE_FIELD_SCHEMA, RoundTypeFieldDef } from './round-type-field-schema';

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
}
