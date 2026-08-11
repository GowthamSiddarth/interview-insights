import { IsString, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  currentPassword!: string;

  // Length floor only, no complexity rules — bcrypt cost already makes
  // brute-forcing expensive, and this is an internal admin/moderator
  // surface, not a public-facing signup form.
  @IsString()
  @MinLength(12)
  newPassword!: string;
}
