import { Module } from '@nestjs/common';

import { AnaliseVozProcessor } from './processors/analise-voz.processor.js';
import { AudioProcessProcessor } from './processors/audio-process.processor.js';
import { AssemblyAIWebhookController } from './webhooks/assemblyai-webhook.controller.js';
import { BotAutostartService } from './services/bot-autostart.service.js';
import { BotStartProcessor } from './processors/bot-start.processor.js';
import { InterviewController } from './interview.controller.js';
import { InterviewService } from './services/interview.service.js';
import { MeetStreamWebhookController } from './webhooks/meetstream-webhook.controller.js';
import { RetencaoLGPDService } from './services/retencao-lgpd.service.js';
import { TranscricaoGraphProcessor } from './processors/transcricao-graph.processor.js';
import { TranscricaoProcessor } from './processors/transcricao.processor.js';

/**
 * Camada 4b/c/d — Entrevistas (bot + transcrição + análise de voz + retenção).
 *
 * Pipeline:
 *  agendar → iniciarBot (cron ou ação manual)
 *           → MeetStream bot entra na sala
 *           → webhook bot.ended
 *           → AudioProcessProcessor (download + criptografia AES-256-GCM + storage)
 *           → TranscricaoProcessor (descripta + AssemblyAI Universal-2 com diarização)
 *           → webhook AssemblyAI.completed
 *           → AnaliseVozProcessor (métricas determinísticas + Claude qualitativo)
 *           → RetencaoLGPDService (cron diário apaga áudios > 90d, trunca transcrições > 365d)
 *
 * Depende dos módulos globais: CryptoModule, StorageModule, MeetStreamModule, AssemblyAIModule.
 */
@Module({
  controllers: [
    InterviewController,
    MeetStreamWebhookController,
    AssemblyAIWebhookController,
  ],
  providers: [
    InterviewService,
    RetencaoLGPDService,
    BotAutostartService,
    BotStartProcessor,
    AudioProcessProcessor,
    TranscricaoProcessor,
    AnaliseVozProcessor,
    TranscricaoGraphProcessor,
  ],
  exports: [InterviewService],
})
export class InterviewModule {}
