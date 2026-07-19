import { Module } from '@nestjs/common';
import { RecruitersService } from './recruiters.service';

@Module({
  providers: [RecruitersService],
  exports: [RecruitersService],
})
export class RecruitersModule {}