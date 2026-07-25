import { Module } from '@nestjs/common';
import { RoundTypeRegistryModule } from '../round-type-registry/round-type-registry.module';
import { RoundsController } from './rounds.controller';
import { RoundsService } from './rounds.service';

@Module({
  imports: [RoundTypeRegistryModule],
  controllers: [RoundsController],
  providers: [RoundsService],
  exports: [RoundsService],
})
export class RoundsModule {}
