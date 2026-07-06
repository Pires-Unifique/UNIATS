import {
  Controller,
  ForbiddenException,
  HttpCode,
  Logger,
  Post,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

import { AlteracaoContratualService } from './alteracao-contratual.service.js';

/**
 * Callback do AUTENTIQUE (assinou/recusou). SEM AuthGuard — chamada externa.
 * Validação por HMAC-SHA256 sobre o RAW body (header `X-Autentique-Signature`),
 * com o segredo `AUTENTIQUE_WEBHOOK_SECRET`. Sem segredo configurado, aceita (dev).
 *
 * O raw body é preservado em req.rawBody pelo express.json({verify}) em main.ts
 * (rota registrada lá). Payload JSON do Autentique:
 *   { event: { type: "signature.accepted", data: { document, public_id, user:{email} } } }
 */
@Controller('webhooks/autentique')
export class AlteracaoContratualWebhookController {
  private readonly logger = new Logger(AlteracaoContratualWebhookController.name);

  constructor(
    private readonly service: AlteracaoContratualService,
    private readonly config: ConfigService,
  ) {}

  @Post()
  @HttpCode(200)
  async receber(@Req() req: Request & { rawBody?: Buffer }) {
    const secret = this.config.get<string>('AUTENTIQUE_WEBHOOK_SECRET');
    if (secret) {
      const assinatura =
        (req.headers['x-autentique-signature'] as string | undefined) ?? '';
      if (!req.rawBody || !this.hmacValido(req.rawBody, assinatura, secret)) {
        this.logger.warn('Webhook Autentique rejeitado: HMAC inválido.');
        throw new ForbiddenException('Assinatura do webhook inválida.');
      }
    } else if (this.config.get<string>('NODE_ENV') === 'production') {
      // Fail-closed: este webhook dispara ação contratual — sem segredo em
      // produção, recusa (não aceita evento de assinatura forjado).
      throw new ServiceUnavailableException(
        'Webhook Autentique desabilitado: AUTENTIQUE_WEBHOOK_SECRET ausente em produção.',
      );
    }

    // Aceita o shape oficial { event: { type, data } } e o shape interno (simulado).
    const body = (req.body ?? {}) as {
      event?: {
        type?: string;
        data?: { document?: string; public_id?: string; user?: { email?: string } };
      };
      documentoId?: string;
      signatarioId?: string;
      evento?: string;
    };
    const ev = body.event;
    const data = ev?.data;

    return this.service.processarWebhookAutentique({
      documentoId: data?.document ?? body.documentoId,
      signatarioId: data?.public_id ?? body.signatarioId,
      signatarioEmail: data?.user?.email,
      evento: ev?.type ?? body.evento,
    });
  }

  /** HMAC-SHA256 hex (com ou sem prefixo "sha256="), comparado em tempo constante. */
  private hmacValido(raw: Buffer, header: string, secret: string): boolean {
    const m = /^(?:sha256=)?([a-f0-9]{64})$/i.exec(header.trim());
    if (!m) return false;
    const recebida = Buffer.from(m[1], 'hex');
    const esperada = createHmac('sha256', secret).update(raw).digest();
    if (recebida.length !== esperada.length) return false;
    try {
      return timingSafeEqual(recebida, esperada);
    } catch {
      return false;
    }
  }
}
