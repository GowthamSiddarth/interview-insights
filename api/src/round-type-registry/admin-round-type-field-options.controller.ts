import { Body, Controller, Get, Param, ParseEnumPipe, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { RoundType } from '@prisma/client';
import { RoundTypeFieldOptionsService } from './round-type-field-options.service';
import { CreateRoundTypeFieldOptionDto } from './dto/create-round-type-field-option.dto';
import { UpdateRoundTypeFieldOptionDto } from './dto/update-round-type-field-option.dto';
import { AdminJwtAuthGuard } from '../admin-auth/guards/admin-jwt-auth.guard';

// Admin surface for managing the round-type registry's controlled-
// vocabulary values (GitHub issue #263, Phase 27) — the write side of
// what issue #248 (Phase 24) only built the read side of. Gated on a
// valid admin_session cookie, same as ModerationController.
@UseGuards(AdminJwtAuthGuard)
@Controller('admin/round-types')
export class AdminRoundTypeFieldOptionsController {
  constructor(private readonly fieldOptionsService: RoundTypeFieldOptionsService) {}

  // Every value (active and inactive) for a round type, unlike the public
  // GET /round-types/field-options which only ever surfaces active ones.
  @Get(':roundType/field-options')
  listAll(@Param('roundType', new ParseEnumPipe(RoundType)) roundType: RoundType) {
    return this.fieldOptionsService.listAllOptions(roundType);
  }

  @Post(':roundType/field-options')
  create(
    @Param('roundType', new ParseEnumPipe(RoundType)) roundType: RoundType,
    @Body() dto: CreateRoundTypeFieldOptionDto,
  ) {
    return this.fieldOptionsService.createOption(roundType, dto);
  }

  // Retiring a value is `isActive: false`, never a hard delete — see D47.
  @Patch('field-options/:id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRoundTypeFieldOptionDto) {
    return this.fieldOptionsService.updateOption(id, dto);
  }
}
