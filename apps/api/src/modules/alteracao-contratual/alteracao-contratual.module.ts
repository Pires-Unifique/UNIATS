import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AuthModule } from '../auth/auth.module.js';
import { AlteracaoContratualController } from './alteracao-contratual.controller.js';
import { AlteracaoContratualWebhookController } from './alteracao-contratual-webhook.controller.js';
import { CatalogoController } from './catalogo.controller.js';
import { AlteracaoContratualService } from './alteracao-contratual.service.js';
import { CatalogoService } from './catalogo.service.js';
import { ExecucaoAlteracaoProcessor } from './processors/execucao-alteracao.processor.js';
import { AutentiqueProvider } from './providers/autentique.provider.js';
import { SeniorProvider } from './providers/senior.provider.js';
import { ExecucaoSchedulerService } from './services/execucao-scheduler.service.js';

/**
 * Módulo de ALTERAÇÃO CONTRATUAL (DHO). PrismaService e as filas são globais.
 * Conectores (Senior/Autentique) plugáveis por env — ver providers.
 */
@Module({
  imports: [AuthModule, ConfigModule],
  controllers: [
    AlteracaoContratualController,
    CatalogoController,
    AlteracaoContratualWebhookController,
  ],
  providers: [
    AlteracaoContratualService,
    CatalogoService,
    SeniorProvider,
    AutentiqueProvider,
    ExecucaoSchedulerService,
    ExecucaoAlteracaoProcessor,
  ],
  exports: [AlteracaoContratualService, CatalogoService],
})
export class AlteracaoContratualModule {}
