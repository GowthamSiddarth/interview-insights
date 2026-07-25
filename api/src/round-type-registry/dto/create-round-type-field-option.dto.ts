import { IsInt, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateRoundTypeFieldOptionDto {
  @IsString()
  @MinLength(1)
  fieldKey!: string;

  @IsString()
  @MinLength(1)
  value!: string;

  // Defaults to appending at the end (service-computed) when omitted.
  @IsOptional()
  @IsInt()
  sortOrder?: number;
}
