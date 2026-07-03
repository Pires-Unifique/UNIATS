import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { MessagingModule } from '../messaging/messaging.module.js';
import { SistemaController } from './sistema.controller.js';
import { SistemaService } from './sistema.service.js';

/**
 * Seção Sistema — operação (status/QR/restart do WAHA + pacing de envios).
 * WahaModule é @Global; o pacer vem do MessagingModule.
 */
@Module({
  imports: [AuthModule, MessagingModule],
  controllers: [SistemaController],
  providers: [SistemaService],
})
export class SistemaModule {}
