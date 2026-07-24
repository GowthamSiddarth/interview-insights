import { Module } from '@nestjs/common';
import { EditThrottleGuard } from './edit-throttle.guard';
import { EditThrottleService } from './edit-throttle.service';

// Imported by RoundRatingsModule/RecruiterRatingsModule/OverallReviewsModule
// — Nest dedupes a shared module across an import tree, so all three get
// the same EditThrottleService instance rather than three independent
// throttle counters per candidate.
@Module({
  providers: [EditThrottleService, EditThrottleGuard],
  // Both must be exported, not just the guard — a guard referenced by
  // class at the controller level (@UseGuards(EditThrottleGuard)) is
  // resolved from the *consuming* module's own DI view, so that module
  // needs EditThrottleService visible too, not only EditThrottleGuard
  // itself (found the hard way: cross-module guard resolution failed
  // with "EditThrottleService... available in RoundRatingsModule" until
  // this was added).
  exports: [EditThrottleService, EditThrottleGuard],
})
export class EditThrottleModule {}
