import { Module } from '@nestjs/common';
import { RoundTypeRegistryController } from './round-type-registry.controller';
import { RoundTypeFieldOptionsService } from './round-type-field-options.service';

@Module({
  controllers: [RoundTypeRegistryController],
  providers: [RoundTypeFieldOptionsService],
  exports: [RoundTypeFieldOptionsService],
})
export class RoundTypeRegistryModule {}
