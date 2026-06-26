import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AuthModule } from '../auth/auth.module.js';
import { ConvitesOffboardingController } from './convites-offboarding.controller.js';
import { OffboardingAutoController } from './offboarding-auto.controller.js';
import { OffboardingController } from './offboarding.controller.js';
import { OffboardingWebhookController } from './offboarding-webhook.controller.js';
import { ProcuradoresController } from './procuradores.controller.js';
import { OffboardingService } from './offboarding.service.js';
import { ProcuradoresService } from './procuradores.service.js';
import { AutentiqueOffboardingProvider } from './providers/autentique-offboarding.provider.js';
import { SeniorOffboardingProvider } from './providers/senior-offboarding.provider.js';
import { EncerramentoConectorService } from './services/encerramento-conector.service.js';

/**
 * Módulo de OFFBOARDING (DHO). PrismaService e StorageService são globais.
 * Conectores (Senior/Autentique) plugáveis por env — ver providers. As
 * integrações de encerramento (TI/benefícios/ponto) ficam em modo simulado.
 */
@Module({
  imports: [AuthModule, ConfigModule],
  controllers: [
    // Controllers com sub-rota fixa (procuradores/convites/auto) ANTES do
    // OffboardingController: as rotas GET /api/offboarding/<fixa> precisam ser
    // registradas antes da genérica GET /api/offboarding/:id (Express casa na
    // ordem de registro), senão a palavra cai no :id e falha o assertUuid.
    ProcuradoresController,
    ConvitesOffboardingController,
    OffboardingAutoController,
    OffboardingController,
    OffboardingWebhookController,
  ],
  providers: [
    OffboardingService,
    ProcuradoresService,
    SeniorOffboardingProvider,
    AutentiqueOffboardingProvider,
    EncerramentoConectorService,
  ],
  exports: [OffboardingService, ProcuradoresService],
})
export class OffboardingModule {}
