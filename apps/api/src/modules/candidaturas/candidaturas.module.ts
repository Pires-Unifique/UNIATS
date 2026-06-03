import { Module } from '@nestjs/common';

import { CandidaturasController } from './candidaturas.controller.js';

@Module({
  controllers: [CandidaturasController],
})
export class CandidaturasModule {}
