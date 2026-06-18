import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { GupyClient } from './gupy.client.js';
import { GupyService } from './gupy.service.js';
import { GupyController } from './gupy.controller.js';
import { GupyWebhookController } from './gupy-webhook.controller.js';
import { GupyWebhookProcessor } from './processors/gupy-webhook.processor.js';
import { GupySyncProcessor } from './processors/gupy-sync.processor.js';

@Module({
  imports: [AuthModule], // AuthService: auto-vínculo gestor↔vaga no sync
  controllers: [GupyController, GupyWebhookController],
  providers: [GupyClient, GupyService, GupyWebhookProcessor, GupySyncProcessor],
  exports: [GupyService, GupyClient],
})
export class GupyModule {}
