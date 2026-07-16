import { Controller, Get, Query } from '@nestjs/common';
import { ReviewSearchService } from './review-search.service';
import { SearchReviewsQueryDto } from './dto/search-reviews-query.dto';

@Controller('search/reviews')
export class ReviewSearchController {
  constructor(private readonly reviewSearchService: ReviewSearchService) {}

  @Get()
  search(@Query() query: SearchReviewsQueryDto) {
    return this.reviewSearchService.search(query);
  }
}
