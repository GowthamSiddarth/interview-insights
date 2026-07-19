import { IsNotEmpty, IsString } from 'class-validator';

export class CreateRecruiterInteractionDto {
  // A candidate-supplied identifier (name and/or email) for the recruiter
  // they interacted with — used only to resolve/de-duplicate the internal
  // Recruiter row (RecruitersService.findOrCreate). Never stored raw, only
  // its hash, and never returned by any endpoint (CLAUDE.md hard constraint
  // #1: never expose a real recruiter name publicly).
  @IsString()
  @IsNotEmpty()
  recruiterIdentifier!: string;
}