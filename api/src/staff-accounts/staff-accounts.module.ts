import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { StaffAccountsController } from './staff-accounts.controller';
import { StaffAccountsService } from './staff-accounts.service';

@Module({
  imports: [AdminAuthModule],
  controllers: [StaffAccountsController],
  providers: [StaffAccountsService],
})
export class StaffAccountsModule {}
