import { IsEmail } from 'class-validator';

export class RequestLinkDto {
  @IsEmail()
  email!: string;
}
