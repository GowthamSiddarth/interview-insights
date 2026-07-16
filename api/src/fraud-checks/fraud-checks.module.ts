import { Module } from '@nestjs/common';
import { FraudChecksService } from './fraud-checks.service';

@Module({
  providers: [FraudChecksService],
  exports: [FraudChecksService],
})
export class FraudChecksModule {}
