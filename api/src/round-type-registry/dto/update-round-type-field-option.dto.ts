import { IsBoolean, IsInt, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateRoundTypeFieldOptionDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  value?: string;

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  // Retiring a value flips this to false rather than deleting the row —
  // historical type_metadata referencing it must stay valid (D47).
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
