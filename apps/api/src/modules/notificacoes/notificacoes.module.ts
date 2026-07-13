import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { NotificacoesController } from './notificacoes.controller.js';
import { NotificacoesService } from './notificacoes.service.js';

/**
 * Notificações internas (sino no header). Canal único in-app. O service é
 * exportado para os pontos de gatilho (InterviewModule) emitirem avisos.
 */
@Module({
  imports: [AuthModule],
  controllers: [NotificacoesController],
  providers: [NotificacoesService],
  exports: [NotificacoesService],
})
export class NotificacoesModule {}
