import 'reflect-metadata';
import './bootstrap-env.js'; // DEVE vir antes do AppModule (carrega .env com override)
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import * as express from 'express';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // Logger estruturado (pino) — substitui o logger padrão
  app.useLogger(app.get(Logger));

  const config = app.get(ConfigService);

  // Gupy: usa express.raw (body fica como Buffer em req.body) — controller faz
  // HMAC + JSON.parse manualmente. Padrão herdado da Camada 1.
  app.use(
    '/webhooks/gupy',
    express.raw({ type: 'application/json', limit: '2mb' }),
  );

  // WAHA e SendGrid: express.json com `verify` que preserva o rawBody em
  // req.rawBody, permitindo HMAC/ECDSA E uso normal de @Body() no controller.
  const jsonComRawBody = express.json({
    limit: '2mb',
    verify: (req, _res, buf) => {
      (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
    },
  });
  app.use('/webhooks/waha', jsonComRawBody);
  app.use('/webhooks/sendgrid', jsonComRawBody);
  app.use('/webhooks/meetstream', jsonComRawBody);
  app.use('/webhooks/assemblyai', jsonComRawBody);

  app.use(express.json({ limit: '2mb' }));

  // ValidationPipe global — Zod faz a validação real,
  // mas mantemos transform/whitelist contra payloads adversariais.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // NÃO definimos global prefix 'api' aqui: os controllers já incluem o
  // segmento 'api/' no @Controller (ex.: @Controller('api/gupy')). Adicionar o
  // prefixo global duplicava as rotas para /api/api/*. Webhooks e health já
  // ficam fora de /api por usarem seus próprios paths (@Controller('webhooks/...') e 'health').

  // CORS — restrito ao frontend conhecido
  app.enableCors({
    origin: config.get<string>('FRONTEND_ORIGIN') ?? 'http://localhost:3000',
    credentials: true,
  });

  // Visibilidade: deixa explícito no boot se a autenticação real está ligada.
  // Em produção o boot já é barrado se estiver off (env.validation.ts), então
  // este aviso só aparece em dev/homolog — onde o admin de dev é injetado.
  if (config.get<boolean>('AUTH_ENABLED') !== true) {
    app
      .get(Logger)
      .warn(
        '⚠️  AUTH_ENABLED=false — autenticação real DESLIGADA (admin de dev ' +
          'injetado em toda requisição). NÃO use com PII real de candidatos.',
      );
  }

  const port = config.get<number>('APP_PORT') ?? 3001;
  await app.listen(port);
  app.get(Logger).log(`API ouvindo em http://localhost:${port}`);
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Falha ao iniciar a API:', err);
  process.exit(1);
});
