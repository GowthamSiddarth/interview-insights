import { IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { CreateRoundDto } from '../../rounds/dto/create-round.dto';
import { CreateRoundRatingDto } from '../../round-ratings/dto/create-round-rating.dto';

// A round nested inside a bulk process submission. `rating` is optional —
// the schema already allows a round with no rating yet (GitHub issue
// #260's "empty process" cleanup exists precisely because that's a real
// state), so the bulk payload mirrors that rather than forcing one.
export class CreateBulkRoundDto extends CreateRoundDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => CreateRoundRatingDto)
  rating?: CreateRoundRatingDto;
}
