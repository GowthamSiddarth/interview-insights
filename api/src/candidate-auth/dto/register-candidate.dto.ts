import { IsEmail, IsString, MinLength } from 'class-validator';

export class RegisterCandidateDto {
  @IsEmail()
  email!: string;

  // Length floor only, no complexity rules — same reasoning as
  // admin-auth's ChangePasswordDto: bcrypt cost already makes
  // brute-forcing expensive.
  @IsString()
  @MinLength(12)
  password!: string;
}
