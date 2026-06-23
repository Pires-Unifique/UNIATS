import { Module } from '@nestjs/common';

import { AdmissaoModule } from '../admissao/admissao.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { GupyClient } from './gupy.client.js';
import { GupyService } from './gupy.service.js';
import { GupyController } from './gupy.controller.js';
import { GupyWebhookController } from './gupy-webhook.controller.js';
import { GupyWebhookProcessor } from './processors/gupy-webhook.processor.js';
import { GupySyncProcessor } from './processors/gupy-sync.processor.js';

@Module({
  // AuthService: auto-vínculo gestor↔vaga; AdmissaoModule: gatilho automático de
  // admissão quando a candidatura entra em CONTRATADO (passou do R&S na Gupy).
  imports: [AuthModule, AdmissaoModule],
  controllers: [GupyController, GupyWebhookController],
  providers: [GupyClient, GupyService, GupyWebhookProcessor, GupySyncProcessor],
  exports: [GupyService, GupyClient],
})
export class GupyModule {}
