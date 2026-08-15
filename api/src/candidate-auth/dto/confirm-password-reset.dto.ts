import { IsString, MinLength } from 'class-validator';

export class ConfirmPasswordResetDto {
  @IsString()
  token!: string;

  // Same floor as RegisterCandidateDto's password field.
  @IsString()
  @MinLength(12)
  newPassword!: string;
}
