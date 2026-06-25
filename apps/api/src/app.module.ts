import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';

import { validateEnv } from './config/env.validation.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { QueueModule } from './queue/queue.module.js';
import { AcessoModule } from './modules/acesso/acesso.module.js';
import { AdmissaoModule } from './modules/admissao/admissao.module.js';
import { AlteracaoContratualModule } from './modules/alteracao-contratual/alteracao-contratual.module.js';
import { AnaliseModule } from './modules/analise/analise.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { CandidaturasModule } from './modules/candidaturas/candidaturas.module.js';
import { ClaudeModule } from './modules/claude/claude.module.js';
import { CryptoModule } from './modules/crypto/crypto.module.js';
import { CurriculoModule } from './modules/curriculo/curriculo.module.js';
import { EmbeddingsModule } from './modules/embeddings/embeddings.module.js';
import { GraphModule } from './modules/graph/graph.module.js';
import { GupyModule } from './modules/gupy/gupy.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { InterviewModule } from './modules/interview/interview.module.js';
import { MessagingModule } from './modules/messaging/messaging.module.js';
import { QuestionsModule } from './modules/questions/questions.module.js';
import { RankingModule } from './modules/ranking/ranking.module.js';
import { VagasModule } from './modules/vagas/vagas.module.js';
import { VagaTemplateModule } from './modules/vaga-template/vaga-template.module.js';
import { SendGridModule } from './modules/sendgrid/sendgrid.module.js';
import { StorageModule } from './modules/storage/storage.module.js';
import { VoyageModule } from './modules/voyage/voyage.module.js';
import { WahaModule } from './modules/waha/waha.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // O .env vive na raiz do monorepo; a API roda com cwd em apps/api.
      envFilePath: ['../../.env', '.env'],
      validate: validateEnv,
    }),

    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        // Redação de campos sensíveis nos logs (LGPD)
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers["x-gupy-signature"]',
            'req.headers.cookie',
            '*.password',
            '*.token',
            '*.api_key',
            '*.cpf',
            '*.cpf_hash',
          ],
          censor: '[REDACTED]',
        },
        transport:
          process.env.LOG_PRETTY === 'true'
            ? { target: 'pino-pretty', options: { singleLine: true } }
            : undefined,
      },
    }),

    ScheduleModule.forRoot(),

    ThrottlerModule.forRoot([
      {
        ttl: Number(process.env.RATE_LIMIT_TTL_MS ?? 60_000),
        limit: Number(process.env.RATE_LIMIT_MAX ?? 120),
      },
    ]),

    PrismaModule,
    AuthModule,
    QueueModule,
    StorageModule,
    CryptoModule,
    ClaudeModule,
    VoyageModule,
    EmbeddingsModule,
    WahaModule,
    SendGridModule,
    GraphModule,
    HealthModule,
    GupyModule,
    CurriculoModule,
    RankingModule,
    MessagingModule,
    InterviewModule,
    QuestionsModule,
    VagasModule,
    VagaTemplateModule,
    CandidaturasModule,
    AnaliseModule,
    AdmissaoModule,
    AcessoModule,
    AlteracaoContratualModule,
  ],
  providers: [
    // Rate limit global como defesa em profundidade
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
