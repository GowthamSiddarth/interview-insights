import { Module } from '@nestjs/common';
import { GlobalAveragesService } from './global-averages.service';

// No controller yet — this lays the shrinkage-scoring groundwork
// (docs/ROADMAP.md Phase 4 issue #8). Issue #9 (the analytics endpoint)
// imports this module for GlobalAveragesService and uses
// computeShrinkageScore directly from shrinkage-score.util.
@Module({
  providers: [GlobalAveragesService],
  exports: [GlobalAveragesService],
})
export class AnalyticsModule {}
