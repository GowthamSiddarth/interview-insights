import { StaffRole } from '@prisma/client';
import { IsEmail, IsEnum, IsString, Matches, MinLength } from 'class-validator';

export class CreateStaffAccountDto {
  @IsString()
  @MinLength(3)
  @Matches(/^[a-z0-9-]+$/, {
    message: 'username may only contain lowercase letters, numbers, and hyphens',
  })
  username!: string;

  @IsEmail()
  email!: string;

  @IsEnum(StaffRole)
  role!: StaffRole;
}
