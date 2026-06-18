import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { AnaliseController } from './analise.controller.js';
import { AnaliseService } from './analise.service.js';

@Module({
  imports: [AuthModule],
  controllers: [AnaliseController],
  providers: [AnaliseService],
})
export class AnaliseModule {}
