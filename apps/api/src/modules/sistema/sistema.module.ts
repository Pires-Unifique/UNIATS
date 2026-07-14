import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { MessagingModule } from '../messaging/messaging.module.js';
import { NotificacoesModule } from '../notificacoes/notificacoes.module.js';
import { SistemaController } from './sistema.controller.js';
import { SistemaService } from './sistema.service.js';
import { WahaWatchdogService } from './waha-watchdog.service.js';

/**
 * Seção Sistema — operação (status/QR/restart do WAHA + pacing de envios).
 * WahaModule é @Global; o pacer vem do MessagingModule; o watchdog alerta
 * admins via NotificacoesModule quando a sessão trava em "WORKING zumbi".
 */
@Module({
  imports: [AuthModule, MessagingModule, NotificacoesModule],
  controllers: [SistemaController],
  providers: [SistemaService, WahaWatchdogService],
})
export class SistemaModule {}
