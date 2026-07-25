import { Module } from '@nestjs/common';
import { RoundTypeRegistryController } from './round-type-registry.controller';
import { AdminRoundTypeFieldOptionsController } from './admin-round-type-field-options.controller';
import { RoundTypeFieldOptionsService } from './round-type-field-options.service';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';

@Module({
  imports: [AdminAuthModule],
  controllers: [RoundTypeRegistryController, AdminRoundTypeFieldOptionsController],
  providers: [RoundTypeFieldOptionsService],
  exports: [RoundTypeFieldOptionsService],
})
export class RoundTypeRegistryModule {}
