import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';

export const QUEUE_NAMES = {
  GUPY_SYNC: 'gupy-sync',
  GUPY_WEBHOOK: 'gupy-webhook',
  CV_DOWNLOAD: 'cv-download',
  CV_PARSE: 'cv-parse',
  EMBEDDING: 'embedding',
  MATCHING: 'matching',
  MENSAGEM: 'mensagem',
  // Transcript oficial do Teams via Graph (pull). Processa pós-reunião com retry.
  TRANSCRICAO_GRAPH: 'transcricao-graph',
  // Fallback: bot Playwright entra na reunião e captura legendas. Consumida pelo
  // serviço externo `services/playwright-bot` (mesmo Redis/prefixo).
  PLAYWRIGHT_JOIN: 'playwright-join',
  // Persistência da transcrição devolvida pelo bot (callback → processor + ATA).
  PLAYWRIGHT_TRANSCRICAO: 'playwright-transcricao',
  // Fusão: quando Teams (diarizado) e Whisper coexistem, o Claude reconcilia na
  // "melhor versão" exibida ao usuário. Disparada pelos dois processors.
  FUSAO_TRANSCRICAO: 'fusao-transcricao',
  // Admissão: OCR do RG (Claude visão) e gatilho de criação de acesso (Acelerato).
  RG_OCR: 'rg-ocr',
  PROVISAO_ACESSO: 'provisao-acesso',
  // Alteração contratual: aplica a mudança no Senior na data exata (cron → fila).
  ALTERACAO_EXECUCAO: 'alteracao-execucao',
} as const;

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url = config.getOrThrow<string>('REDIS_URL');
        return {
          connection: { url } as any, // ioredis aceita a URL
          prefix: config.get<string>('REDIS_QUEUE_PREFIX') ?? 'uniats',
          defaultJobOptions: {
            attempts: 5,
            backoff: { type: 'exponential', delay: 1000 },
            removeOnComplete: { age: 24 * 3600, count: 1000 },
            removeOnFail: { age: 7 * 24 * 3600 },
          },
        };
      },
    }),

    // Registro de todas as filas conhecidas
    BullModule.registerQueue(
      { name: QUEUE_NAMES.GUPY_SYNC },
      { name: QUEUE_NAMES.GUPY_WEBHOOK },
      { name: QUEUE_NAMES.CV_DOWNLOAD },
      { name: QUEUE_NAMES.CV_PARSE },
      { name: QUEUE_NAMES.EMBEDDING },
      { name: QUEUE_NAMES.MATCHING },
      { name: QUEUE_NAMES.MENSAGEM },
      { name: QUEUE_NAMES.TRANSCRICAO_GRAPH },
      { name: QUEUE_NAMES.PLAYWRIGHT_JOIN },
      { name: QUEUE_NAMES.PLAYWRIGHT_TRANSCRICAO },
      { name: QUEUE_NAMES.FUSAO_TRANSCRICAO },
      { name: QUEUE_NAMES.RG_OCR },
      { name: QUEUE_NAMES.PROVISAO_ACESSO },
      { name: QUEUE_NAMES.ALTERACAO_EXECUCAO },
    ),
  ],
  exports: [BullModule],
})
export class QueueModule {}
