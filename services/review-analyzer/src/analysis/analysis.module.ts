import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { PrismaModule } from '../prisma/prisma.module';
import { anthropicClientProvider } from './anthropic-client.provider';
import { AnalysisService } from './analysis.service';
import { AnalysisConsumerService } from './analysis-consumer.service';
import { ReconciliationSweepService } from './reconciliation-sweep.service';

@Module({
  imports: [EventsModule, PrismaModule],
  providers: [anthropicClientProvider, AnalysisService, AnalysisConsumerService, ReconciliationSweepService],
})
export class AnalysisModule {}
