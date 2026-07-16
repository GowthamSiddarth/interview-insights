import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';

@Controller('companies/:companyId/analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get()
  getCompanyAnalytics(@Param('companyId', ParseUUIDPipe) companyId: string) {
    return this.analyticsService.getCompanyAnalytics(companyId);
  }
}
