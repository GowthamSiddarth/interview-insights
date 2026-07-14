import { ProcessOutcome } from '@prisma/client';
import { IsDateString, IsEnum, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateInterviewProcessDto {
  @IsUUID()
  candidateId!: string;

  @IsString()
  @IsNotEmpty()
  roleTitle!: string;

  @IsOptional()
  @IsString()
  level?: string;

  @IsOptional()
  @IsString()
  department?: string;

  @IsOptional()
  @IsDateString()
  applicationDate?: string;

  @IsEnum(ProcessOutcome)
  outcome!: ProcessOutcome;
}
