import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { ChavesApiController } from './chaves-api.controller.js';
import { ChavesApiService } from './chaves-api.service.js';

/** Chaves de API — acesso de máquina com escopos (tela da seção Sistema). */
@Module({
  imports: [AuthModule],
  controllers: [ChavesApiController],
  providers: [ChavesApiService],
})
export class ChavesApiModule {}
