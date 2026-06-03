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
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Request } from 'express';

import { MessagingService } from '../messaging.service.js';
import { PrismaService } from '../../../prisma/prisma.service.js';

/**
 * Receiver do WAHA Webhook (https://waha.devlike.pro/docs/how-to/events/).
 *
 * Eventos relevantes:
 *  - `message` — mensagem recebida do candidato (direcao=ENTRADA). Gravamos em `mensagens`.
 *  - `message.ack` — confirmações de delivery: SENT/RECEIVED/READ → ENVIADO/ENTREGUE/LIDO.
 *  - `session.status` — útil para alertar quando a sessão é desconectada.
 *
 * Segurança:
 *  - HMAC-SHA256 sobre o RAW body se WAHA_WEBHOOK_SECRET estiver configurado.
 *  - Idempotência via tabela `webhooks_recebidos` (provider="waha", external_id=event id).
 *  - FORA do prefixo /api — endpoint público, autenticado por HMAC.
 */
@Controller('webhooks/waha')
export class WahaWebhookController {
  private readonly logger = new Logger(WahaWebhookController.name);
  private readonly secret?: string;

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly messaging: MessagingService,
  ) {
    this.secret = config.get<string>('WAHA_WEBHOOK_SECRET');
    if (!this.secret) {
      this.logger.warn(
        'WAHA_WEBHOOK_SECRET ausente — webhooks WAHA NÃO serão autenticados. ' +
          'Em produção, defina o secret e configure a sessão para enviar X-Webhook-Hmac.',
      );
    }
  }

  @Post()
  @HttpCode(202)
  async receber(
    @Req() req: Request,
    @Headers('x-webhook-hmac') assinatura: string | undefined,
    @Body() body: unknown,
  ): Promise<{ status: string; eventId?: string }> {
    // 1) Autenticação
    if (this.secret) {
      this.verificarHmac(req, assinatura);
    }

    // 2) Schema (parse permissivo — WAHA evolui rápido)
    const envelope = this.parseEnvelope(body);

    // 3) Idempotência — único por (provider, external_id)
    try {
      await this.prisma.webhookRecebido.create({
        data: {
          provider: 'waha',
          external_id: envelope.id,
          evento: envelope.event,
          payload: envelope as unknown as object,
          recebido_em: new Date(),
        },
      });
    } catch (err) {
      // P2002 = unique violation → já recebido antes; responde 200 sem reprocessar.
      if ((err as { code?: string }).code === 'P2002') {
        return { status: 'duplicate', eventId: envelope.id };
      }
      this.logger.error(
        `Falha ao registrar webhook WAHA: ${(err as Error).message}`,
      );
      throw err;
    }

    // 4) Processa por tipo de evento (síncrono leve — operações pequenas)
    try {
      await this.processar(envelope);
    } catch (err) {
      this.logger.error(
        `Erro ao processar evento WAHA ${envelope.event}: ${(err as Error).message}`,
      );
      // Não rejeitamos aqui — o webhook já foi registrado e a próxima entrega
      // do mesmo evento será deduplicada. Resolvemos manualmente se preciso.
    }

    return { status: 'ok', eventId: envelope.id };
  }

  /** ----------------------------------------------------------------------
   *  Internos
   *  --------------------------------------------------------------------- */

  private verificarHmac(req: Request, assinatura?: string): void {
    if (!assinatura) {
      throw new UnauthorizedException('Assinatura HMAC ausente.');
    }
    const raw = (req as Request & { rawBody?: Buffer }).rawBody;
    if (!raw) {
      this.logger.error(
        'WAHA webhook recebido sem rawBody — middleware express.raw não está mapeado para /webhooks/waha.',
      );
      throw new BadRequestException(
        'Configuração de raw body ausente para /webhooks/waha.',
      );
    }
    const esperado = createHmac('sha256', this.secret!)
      .update(raw)
      .digest('hex');

    const a = Buffer.from(esperado, 'hex');
    const b = Buffer.from(assinatura.replace(/^sha256=/, ''), 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Assinatura HMAC inválida.');
    }
  }

  private parseEnvelope(body: unknown): {
    id: string;
    event: string;
    session: string;
    payload: Record<string, unknown>;
    timestamp?: number;
  } {
    if (!body || typeof body !== 'object') {
      throw new BadRequestException('Body vazio.');
    }
    const obj = body as Record<string, unknown>;
    const id = String(obj.id ?? '');
    const event = String(obj.event ?? '');
    if (!id || !event) {
      throw new BadRequestException(
        'Envelope WAHA inválido — faltam `id` ou `event`.',
      );
    }
    return {
      id,
      event,
      session: String(obj.session ?? 'default'),
      payload: (obj.payload as Record<string, unknown>) ?? {},
      timestamp: typeof obj.timestamp === 'number' ? obj.timestamp : undefined,
    };
  }

  private async processar(envelope: {
    event: string;
    payload: Record<string, unknown>;
    timestamp?: number;
  }): Promise<void> {
    const ts = envelope.timestamp
      ? new Date(envelope.timestamp * 1000)
      : new Date();

    if (envelope.event === 'message.ack') {
      const ack = envelope.payload as {
        id?: string | { _serialized?: string };
        ack?: number; // 0=erro,1=enviado,2=entregue,3=lido,4=playback
      };
      const messageId =
        typeof ack.id === 'string' ? ack.id : ack.id?._serialized;
      if (!messageId) return;

      const mapa: Record<number, 'ENVIADO' | 'ENTREGUE' | 'LIDO' | 'FALHADO'> =
        {
          0: 'FALHADO',
          1: 'ENVIADO',
          2: 'ENTREGUE',
          3: 'LIDO',
          4: 'LIDO',
        };
      const novo = mapa[ack.ack ?? -1];
      if (!novo) return;
      await this.messaging.atualizarStatusWebhook(messageId, novo, ts);
      return;
    }

    if (envelope.event === 'message') {
      const msg = envelope.payload as {
        id?: string | { _serialized?: string };
        from?: string; // chatId do candidato
        body?: string;
        fromMe?: boolean;
      };
      if (msg.fromMe) return; // mensagem enviada por nós — não tratamos aqui

      const chatId = msg.from;
      if (!chatId) return;

      // Encontra a última mensagem de SAÍDA para esse chatId — marca como RESPONDIDO
      // e cria registro de entrada associado à mesma candidatura/candidato.
      const ultima = await this.prisma.mensagem.findFirst({
        where: { destino: chatId, direcao: 'SAIDA' },
        orderBy: { criado_em: 'desc' },
        select: {
          candidato_id: true,
          candidatura_id: true,
          provider_msg_id: true,
        },
      });

      if (ultima?.provider_msg_id) {
        await this.messaging.atualizarStatusWebhook(
          ultima.provider_msg_id,
          'RESPONDIDO',
          ts,
        );
      }
      if (ultima) {
        const corpo = (msg.body ?? '').slice(0, 4000);
        await this.prisma.mensagem.create({
          data: {
            candidatura_id: ultima.candidatura_id,
            candidato_id: ultima.candidato_id,
            canal: 'WHATSAPP',
            direcao: 'ENTRADA',
            corpo,
            destino: chatId,
            provider: 'waha',
            provider_msg_id:
              typeof msg.id === 'string' ? msg.id : msg.id?._serialized,
            status: 'ENTREGUE',
            entregue_em: ts,
          },
        });
      } else {
        this.logger.warn(
          `Mensagem ENTRADA de ${chatId} sem candidatura prévia — descartando.`,
        );
      }
      return;
    }

    if (envelope.event === 'session.status') {
      const status = (envelope.payload as { status?: string }).status;
      this.logger.warn(`WAHA session status: ${status}`);
      return;
    }

    this.logger.debug(`Evento WAHA não tratado: ${envelope.event}`);
  }
}
