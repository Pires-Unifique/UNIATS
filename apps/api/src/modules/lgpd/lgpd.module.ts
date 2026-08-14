import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { LgpdController } from './lgpd.controller.js';
import { RetencaoDadosService } from './retencao-dados.service.js';

/**
 * Ciclo de vida do dado do candidato — Art. 16 (retenção) e Art. 18 (eliminação).
 *
 * Separado do módulo de entrevista de propósito: lá o RetencaoLGPDService trata
 * do que é da entrevista (áudio e transcrição); aqui tratamos do candidato
 * inteiro, que atravessa recrutamento, mensageria e currículo.
 */
@Module({
  imports: [AuthModule, StorageModule],
  controllers: [LgpdController],
  providers: [RetencaoDadosService],
  exports: [RetencaoDadosService],
})
export class LgpdModule {}
