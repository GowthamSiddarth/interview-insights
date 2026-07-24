import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { CandidatesService } from './candidates.service';

// POST / (candidate creation) was removed here (GitHub issue #146) — it's
// now part of the auth flow (POST /auth/request-link upserts internally
// via CandidatesService.create(), never exposed as its own public route)
// rather than a standalone endpoint anyone could call directly to mint a
// candidate identity without ever proving email ownership.
@Controller('candidates')
export class CandidatesController {
  constructor(private readonly candidatesService: CandidatesService) {}

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.candidatesService.findOne(id);
  }
}
