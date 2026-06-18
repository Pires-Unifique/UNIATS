import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { CandidaturasController } from './candidaturas.controller.js';

@Module({
  imports: [AuthModule],
  controllers: [CandidaturasController],
})
export class CandidaturasModule {}
