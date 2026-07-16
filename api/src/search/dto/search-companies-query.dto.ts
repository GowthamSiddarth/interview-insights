import { IsNotEmpty, IsString } from 'class-validator';

export class SearchCompaniesQueryDto {
  @IsString()
  @IsNotEmpty()
  q!: string;
}
