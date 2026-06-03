import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPublicKey, createVerify } from 'node:crypto';
import { Request } from 'express';

import { MessagingService } from '../messaging.service.js';
import { PrismaService } from '../../../prisma/prisma.service.js';

/**
 * Receiver do SendGrid Event Webhook.
 *
 * Assinatura: ECDSA P-256 com SHA-256 sobre `timestamp + raw_body`. A chave
 * pública vem do painel SendGrid (Mail Settings → Event Webhook) e é configurada
 * em SENDGRID_WEBHOOK_PUBLIC_KEY (PEM ou base64-DER).
 *
 * Eventos relevantes: processed, delivered, open, click, bounce, dropped, spam.
 *
 * Documentação:
 *   https://docs.sendgrid.com/for-developers/tracking-events/getting-started-event-webhook-security-features
 */
@Controller('webhooks/sendgrid')
export class SendGridWebhookController {
  private readonly logger = new Logger(SendGridWebhookController.name);
  private readonly publicKeyPem?: string;

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly messaging: MessagingService,
  ) {
    const raw = config.get<string>('SENDGRID_WEBHOOK_PUBLIC_KEY');
    if (raw) {
      // SendGrid entrega a chave em base64-DER; normalizamos para PEM.
      this.publicKeyPem = raw.includes('BEGIN PUBLIC KEY')
        ? raw
        : `-----BEGIN PUBLIC KEY-----\n${raw.match(/.{1,64}/g)?.join('\n') ?? ''}\n-----END PUBLIC KEY-----`;
    } else {
      this.logger.warn(
        'SENDGRID_WEBHOOK_PUBLIC_KEY ausente — webhooks SendGrid NÃO serão autenticados.',
      );
    }
  }

  @Post()
  @HttpCode(202)
  async receber(
    @Req() req: Request,
    @Headers('x-twilio-email-event-webhook-signature') assinatura: string | undefined,
    @Headers('x-twilio-email-event-webhook-timestamp') timestamp: string | undefined,
    @Body() body: unknown,
  ): Promise<{ status: string; processados: number }> {
    if (this.publicKeyPem) {
      this.verificarAssinatura(req, assinatura, timestamp);
    }

    if (!Array.isArray(body)) {
      throw new BadRequestException(
        'Body do SendGrid deve ser array de eventos.',
      );
    }

    let processados = 0;
    for (const evt of body) {
      try {
        await this.processarEvento(evt as Record<string, unknown>);
        processados++;
      } catch (err) {
        this.logger.error(
          `Falha ao processar evento SendGrid: ${(err as Error).message}`,
        );
      }
    }

    return { status: 'ok', processados };
  }

  /** ----------------------------------------------------------------------
   *  Internos
   *  --------------------------------------------------------------------- */

  private verificarAssinatura(
    req: Request,
    assinaturaB64: string | undefined,
    timestamp: string | undefined,
  ): void {
    if (!assinaturaB64 || !timestamp) {
      throw new UnauthorizedException(
        'Headers de assinatura SendGrid ausentes.',
      );
    }
    const raw = (req as Request & { rawBody?: Buffer }).rawBody;
    if (!raw) {
      throw new BadRequestException(
        'rawBody ausente em /webhooks/sendgrid — middleware express.raw mal configurado.',
      );
    }

    // Anti-replay: rejeita timestamp com diferença > 10 minutos.
    const ts = Number(timestamp);
    if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 600) {
      throw new UnauthorizedException(
        'Timestamp do webhook fora da janela aceitável.',
      );
    }

    const payloadAssinado = Buffer.concat([
      Buffer.from(timestamp, 'utf8'),
      raw,
    ]);

    const pubKey = createPublicKey(this.publicKeyPem!);
    const verify = createVerify('sha256');
    verify.update(payloadAssinado);
    const ok = verify.verify(pubKey, assinaturaB64, 'base64');
    if (!ok) {
      throw new UnauthorizedException('Assinatura SendGrid inválida.');
    }
  }

  private async processarEvento(evt: Record<string, unknown>): Promise<void> {
    const event = String(evt.event ?? '');
    const sgMessageId = (evt['sg_message_id'] as string | undefined) ?? '';
    // O message-id retornado em `enviarEmail` é o header `x-message-id` que
    // o SendGrid embute como prefixo do sg_message_id: "<id>.<random>.filter…"
    const messageIdPrefixo = sgMessageId.split('.')[0];
    const customArgs = evt as Record<string, unknown>;
    const candidaturaId = customArgs.candidaturaId as string | undefined;
    const mensagemId = customArgs.mensagemId as string | undefined;
    const tsEpoch = Number(evt.timestamp ?? 0);
    const ts = tsEpoch ? new Date(tsEpoch * 1000) : new Date();

    // Idempotência defensiva: usa "sg_event_id" se presente.
    const externalId = String(evt['sg_event_id'] ?? `${sgMessageId}-${event}-${tsEpoch}`);
    try {
      await this.prisma.webhookRecebido.create({
        data: {
          provider: 'sendgrid',
          external_id: externalId,
          evento: event,
          payload: evt as unknown as object,
          recebido_em: new Date(),
        },
      });
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') return; // dedup
      throw err;
    }

    const mapa: Record<string, 'ENVIADO' | 'ENTREGUE' | 'LIDO' | 'FALHADO'> = {
      processed: 'ENVIADO',
      delivered: 'ENTREGUE',
      open: 'LIDO',
      click: 'LIDO',
      bounce: 'FALHADO',
      dropped: 'FALHADO',
      deferred: 'ENVIADO',
      spamreport: 'FALHADO',
    };
    const novo = mapa[event];
    if (!novo) return;

    if (mensagemId) {
      // Atualização direta por id interno (mais barato e confiável).
      try {
        const m = await this.prisma.mensagem.findUnique({
          where: { id: mensagemId },
          select: { id: true, status: true, provider_msg_id: true },
        });
        if (m && m.provider_msg_id) {
          await this.messaging.atualizarStatusWebhook(
            m.provider_msg_id,
            novo,
            ts,
          );
        }
      } catch {
        // ignora — o lookup por messageIdPrefixo é fallback.
      }
    }
    if (messageIdPrefixo) {
      await this.messaging.atualizarStatusWebhook(
        messageIdPrefixo,
        novo,
        ts,
      );
    }

    if (novo === 'FALHADO' && candidaturaId) {
      this.logger.warn(
        `E-mail FALHADO event=${event} candidatura=${candidaturaId} sg=${sgMessageId}`,
      );
    }
  }
}
