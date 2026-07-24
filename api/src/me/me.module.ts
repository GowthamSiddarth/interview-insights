import { Module } from '@nestjs/common';
import { CandidateAuthModule } from '../candidate-auth/candidate-auth.module';
import { MeController } from './me.controller';
import { MeService } from './me.service';

@Module({
  imports: [CandidateAuthModule],
  controllers: [MeController],
  providers: [MeService],
})
export class MeModule {}
