import { IsNotEmpty, IsString } from 'class-validator';

export class VerifyCandidateDto {
  @IsString()
  @IsNotEmpty()
  token!: string;
}
