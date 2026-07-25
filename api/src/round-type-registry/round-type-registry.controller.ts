import { Controller, Get } from '@nestjs/common';
import { RoundTypeFieldOptionsService } from './round-type-field-options.service';

@Controller('round-types')
export class RoundTypeRegistryController {
  constructor(private readonly fieldOptionsService: RoundTypeFieldOptionsService) {}

  // Public, no auth — this is read-only reference data every visitor's
  // wizard needs to render round-creation fields (consumed starting Phase
  // 26/issue #254). Admin management of the underlying option values is
  // Phase 27.
  @Get('field-options')
  getFieldOptions() {
    return this.fieldOptionsService.getFullSchemaWithOptions();
  }
}
