import { IsEmail } from 'class-validator';

export class CreateCandidateDto {
  @IsEmail()
  email!: string;
}
