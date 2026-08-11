import { StaffRole } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class UpdateStaffRoleDto {
  @IsEnum(StaffRole)
  role!: StaffRole;
}
