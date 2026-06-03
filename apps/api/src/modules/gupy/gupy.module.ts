import { Module } from '@nestjs/common';

import { GupyClient } from './gupy.client.js';
import { GupyService } from './gupy.service.js';
import { GupyController } from './gupy.controller.js';
import { GupyWebhookController } from './gupy-webhook.controller.js';
import { GupyWebhookProcessor } from './processors/gupy-webhook.processor.js';
import { GupySyncProcessor } from './processors/gupy-sync.processor.js';

@Module({
  controllers: [GupyController, GupyWebhookController],
  providers: [GupyClient, GupyService, GupyWebhookProcessor, GupySyncProcessor],
  exports: [GupyService, GupyClient],
})
export class GupyModule {}
