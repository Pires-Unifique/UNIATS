import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Request } from 'express';

import {
  WebhookGupyEvento,
  WebhookGupyInvolucroSchema,
} from '@uniats/shared';

import { PrismaService } from '../../prisma/prisma.service.js';
import { QUEUE_NAMES } from '../../queue/queue.module.js';

/**
 * Webhook receiver da Gupy.
 *
 * Pipeline:
 *  1. Valida assinatura HMAC sobre o RAW BODY (express.raw em main.ts).
 *  2. Parse Zod no envelope — payload malformado é registrado e descartado com 400.
 *  3. Idempotência: tenta inserir `webhooks_recebidos` com unique(provider, external_id).
 *     Se já existe → responde 200 sem reprocessar.
 *  4. Enfileira em BullMQ para processamento assíncrono — handler HTTP responde rápido.
 *
 * Importante: este endpoint fica FORA do prefixo /api e FORA do guard de SSO.
 * A autenticação é feita inteiramente via HMAC.
 */
@Controller('webhooks/gupy')
export class GupyWebhookController {
  private readonly logger = new Logger(GupyWebhookController.name);
  private readonly secret: string;

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_NAMES.GUPY_WEBHOOK)
    private readonly fila: Queue,
  ) {
    // Opcional no MVP: sem secret, o webhook fica desabilitado (responde 503).
    // O fluxo de sync via API key (POST /api/gupy/sync/...) não depende disto.
    this.secret = config.get<string>('GUPY_WEBHOOK_SECRET') ?? '';
    if (!this.secret) {
      this.logger.warn(
        'GUPY_WEBHOOK_SECRET ausente — endpoint /webhooks/gupy DESABILITADO. Use o sync via API key.',
      );
    }
  }

  @Post()
  @HttpCode(202) // Accepted — processamento é assíncrono.
  async receber(
    @Req() req: Request,
    @Headers('x-gupy-signature') assinatura: string | undefined,
    @Headers('x-gupy-event-id') eventIdHeader: string | undefined,
  ): Promise<{ status: string; id?: string }> {
    // 0) Webhook desabilitado se o secret não foi configurado (MVP).
    if (!this.secret) {
      throw new ServiceUnavailableException(
        'Webhook da Gupy desabilitado (GUPY_WEBHOOK_SECRET ausente).',
      );
    }

    // 1) Assinatura HMAC
    // O middleware express.raw deixa o body como Buffer em req.body.
    const raw = req.body;
    if (!Buffer.isBuffer(raw) || raw.length === 0) {
      throw new BadRequestException('Body vazio ou não-binário');
    }
    if (!assinatura) {
      throw new UnauthorizedException('Assinatura ausente');
    }
    if (!this.assinaturaValida(raw, assinatura)) {
      // Log SEM o segredo nem a assinatura recebida (pode vazar oracle de timing).
      this.logger.warn('Webhook Gupy rejeitado: HMAC inválido');
      throw new UnauthorizedException('Assinatura inválida');
    }

    // 2) Parse + envelope
    let json: unknown;
    try {
      json = JSON.parse(raw.toString('utf8'));
    } catch {
      throw new BadRequestException('JSON malformado');
    }

    const parsed = WebhookGupyInvolucroSchema.safeParse(json);
    if (!parsed.success) {
      this.logger.warn(
        `Envelope inválido: ${parsed.error.issues.map((i) => i.path.join('.')).join(',')}`,
      );
      throw new BadRequestException('Envelope inválido');
    }
    const envelope = parsed.data;
    const externalId = envelope.eventId ?? eventIdHeader ?? null;

    // 3) Idempotência
    try {
      const registro = await this.prisma.webhookRecebido.create({
        data: {
          provider: 'gupy',
          evento: envelope.event,
          external_id: externalId,
          assinatura_ok: true,
          payload: envelope as any,
        },
      });

      // 4) Enfileira o processamento
      await this.fila.add(
        envelope.event,
        { webhookId: registro.id, event: envelope.event as WebhookGupyEvento },
        {
          jobId: `gupy-wh-${registro.id}`,
          attempts: 8,
          backoff: { type: 'exponential', delay: 2000 },
        },
      );

      return { status: 'accepted', id: registro.id };
    } catch (err: any) {
      // P2002 = unique constraint → evento já recebido antes.
      if (err?.code === 'P2002') {
        this.logger.log(
          `Webhook duplicado ignorado: provider=gupy event=${envelope.event} external_id=${externalId}`,
        );
        return { status: 'duplicate' };
      }
      throw err;
    }
  }

  /**
   * Valida o header `X-Gupy-Signature` no formato:
   *   "sha256=<hex>"
   * usando `timingSafeEqual` para evitar oracle de timing.
   */
  private assinaturaValida(raw: Buffer, header: string): boolean {
    const match = /^sha256=([a-f0-9]{64})$/i.exec(header.trim());
    if (!match) return false;
    const recebida = Buffer.from(match[1] as string, 'hex');
    const esperada = createHmac('sha256', this.secret).update(raw).digest();
    if (recebida.length !== esperada.length) return false;
    try {
      return timingSafeEqual(recebida, esperada);
    } catch {
      return false;
    }
  }
}
