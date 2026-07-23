import { Module } from '@nestjs/common';
import { ModerationController } from './moderation.controller';
import { ModerationService } from './moderation.service';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { SearchModule } from '../search/search.module';

@Module({
  imports: [SearchModule, AdminAuthModule],
  controllers: [ModerationController],
  providers: [ModerationService],
  exports: [ModerationService],
})
export class ModerationModule {}
