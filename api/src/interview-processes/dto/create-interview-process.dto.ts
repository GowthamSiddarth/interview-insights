import { ProcessOutcome } from '@prisma/client';
import { IsDateString, IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';

// candidateId is deliberately not a field here (GitHub issue #146) — it
// comes from the authenticated session (CurrentCandidateId), never from
// client input, so a candidate can't submit as another.
export class CreateInterviewProcessDto {
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
