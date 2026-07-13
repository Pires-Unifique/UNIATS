import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { NotificacoesModule } from '../notificacoes/notificacoes.module.js';
import { QuestionsModule } from '../questions/questions.module.js';
import { InterviewController } from './interview.controller.js';
import { InterviewService } from './services/interview.service.js';
import { PlaywrightAutostartService } from './services/playwright-autostart.service.js';
import { PlaywrightCallbackController } from './webhooks/playwright-callback.controller.js';
import { PlaywrightTranscricaoProcessor } from './processors/playwright-transcricao.processor.js';
import { FusaoTranscricaoProcessor } from './processors/fusao-transcricao.processor.js';
import { ConfirmarEnqueteProcessor } from './processors/confirmar-enquete.processor.js';
import { EnviarLinkProcessor } from './processors/enviar-link.processor.js';
import { PreReservaCleanupService } from './services/pre-reserva-cleanup.service.js';
import { RetencaoLGPDService } from './services/retencao-lgpd.service.js';
import { TranscricaoGraphProcessor } from './processors/transcricao-graph.processor.js';
import { TranscricaoGraphSchedulerService } from './services/transcricao-graph-scheduler.service.js';

/**
 * Camada 4 — Entrevistas (agendamento Teams + transcrição via Graph + retenção).
 *
 * Pipeline (sem bot na sala):
 *  confirmarPorEnquete → cria reunião Teams (Graph) + liga auto-transcrição (PATCH,
 *    idioma pt-BR) → TranscricaoGraphSchedulerService (cron) puxa o transcript
 *    oficial pós-reunião → TranscricaoGraphProcessor (VTT → Claude gera a ATA)
 *    → RetencaoLGPDService (cron diário trunca transcrições antigas).
 *
 * Fallback: PlaywrightAutostartService + PlaywrightTranscricaoProcessor (bot que
 * captura legendas) — só age se PLAYWRIGHT_BOT_ENABLED.
 */
@Module({
  imports: [AuthModule, QuestionsModule, NotificacoesModule],
  controllers: [InterviewController, PlaywrightCallbackController],
  providers: [
    InterviewService,
    RetencaoLGPDService,
    TranscricaoGraphSchedulerService,
    PlaywrightAutostartService,
    TranscricaoGraphProcessor,
    PlaywrightTranscricaoProcessor,
    FusaoTranscricaoProcessor,
    ConfirmarEnqueteProcessor,
    EnviarLinkProcessor,
    PreReservaCleanupService,
  ],
  exports: [InterviewService],
})
export class InterviewModule {}
