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
  BOT_ENTREVISTA: 'bot-entrevista',
  AUDIO_PROCESS: 'audio-process',
  TRANSCRICAO: 'transcricao',
  ANALISE_VOZ: 'analise-voz',
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
          prefix: config.get<string>('REDIS_QUEUE_PREFIX') ?? 'triagem',
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
      { name: QUEUE_NAMES.BOT_ENTREVISTA },
      { name: QUEUE_NAMES.AUDIO_PROCESS },
      { name: QUEUE_NAMES.TRANSCRICAO },
      { name: QUEUE_NAMES.ANALISE_VOZ },
    ),
  ],
  exports: [BullModule],
})
export class QueueModule {}
