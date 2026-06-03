import { Module } from '@nestjs/common';

import { AnaliseController } from './analise.controller.js';
import { AnaliseService } from './analise.service.js';

@Module({
  controllers: [AnaliseController],
  providers: [AnaliseService],
})
export class AnaliseModule {}
