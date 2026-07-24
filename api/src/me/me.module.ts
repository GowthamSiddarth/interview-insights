import { Module } from '@nestjs/common';
import { CandidateAuthModule } from '../candidate-auth/candidate-auth.module';
import { SearchModule } from '../search/search.module';
import { MeController } from './me.controller';
import { MeService } from './me.service';

@Module({
  imports: [CandidateAuthModule, SearchModule],
  controllers: [MeController],
  providers: [MeService],
})
export class MeModule {}
