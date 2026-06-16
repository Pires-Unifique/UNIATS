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
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Request } from 'express';

import { PrismaService } from '../../../prisma/prisma.service.js';
import { QUEUE_NAMES } from '../../../queue/queue.module.js';

/**
 * Receiver do MeetStream Webhook.
 *
 * Eventos esperados (subject a confirmação no painel MeetStream):
 *  - `bot.joined` — bot entrou na sala. Atualiza `iniciada_em` + `bot_status`.
 *  - `bot.recording` — começou a gravar.
 *  - `bot.ended` — gravação encerrada. Enfileira AUDIO_PROCESS.
 *  - `bot.failed` — erro fatal. Marca entrevista como cancelada.
 *
 * Segurança:
 *  - HMAC-SHA256 sobre raw body se MEETSTREAM_WEBHOOK_SECRET configurado.
 *  - Idempotência via `webhooks_recebidos`.
 *  - FORA do prefixo /api.
 */
@Controller('webhooks/meetstream')
export class MeetStreamWebhookController {
  private readonly logger = new Logger(MeetStreamWebhookController.name);
  private readonly secret?: string;

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_NAMES.AUDIO_PROCESS)
    private readonly filaAudio: Queue,
    // BAKE-OFF temporário — remover junto com TranscricaoBench.
    @InjectQueue(QUEUE_NAMES.TRANSCRICAO_BENCH)
    private readonly filaBench: Queue,
  ) {
    this.secret = config.get<string>('MEETSTREAM_WEBHOOK_SECRET');
    if (!this.secret) {
      this.logger.warn(
        'MEETSTREAM_WEBHOOK_SECRET ausente — webhooks NÃO serão autenticados (defina em produção).',
      );
    }
  }

  @Post()
  @HttpCode(202)
  async receber(
    @Req() req: Request,
    @Headers('x-webhook-signature') assinatura: string | undefined,
    @Body() body: unknown,
  ): Promise<{ status: string; eventId?: string }> {
    if (this.secret) {
      this.verificarHmac(req, assinatura);
    }

    const evento = this.parseEvento(body);

    // Idempotência
    try {
      await this.prisma.webhookRecebido.create({
        data: {
          provider: 'meetstream',
          external_id: evento.id,
          evento: evento.type,
          payload: body as unknown as object,
          assinatura_ok: Boolean(this.secret) && Boolean(assinatura),
          recebido_em: new Date(),
        },
      });
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        return { status: 'duplicate', eventId: evento.id };
      }
      throw err;
    }

    await this.processar(evento);

    return { status: 'ok', eventId: evento.id };
  }

  /** ----------------------------------------------------------------------
   *  Internos
   *  --------------------------------------------------------------------- */

  private verificarHmac(req: Request, assinatura?: string): void {
    if (!assinatura) {
      throw new UnauthorizedException('Assinatura ausente.');
    }
    const raw = (req as Request & { rawBody?: Buffer }).rawBody;
    if (!raw) {
      throw new BadRequestException('rawBody ausente — express.raw mal configurado.');
    }
    const esperado = createHmac('sha256', this.secret!).update(raw).digest('hex');
    const a = Buffer.from(esperado, 'hex');
    const b = Buffer.from(assinatura.replace(/^sha256=/, ''), 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Assinatura inválida.');
    }
  }

  private parseEvento(body: unknown): {
    id: string;
    type: string;
    botId?: string;
    timestamp?: number;
    data: Record<string, unknown>;
  } {
    if (!body || typeof body !== 'object') {
      throw new BadRequestException('Body vazio.');
    }
    const obj = body as Record<string, unknown>;
    const id = String(obj.id ?? obj.event_id ?? '');
    const type = String(obj.event ?? obj.type ?? '');
    const botId =
      (obj.bot_id as string | undefined) ??
      ((obj.data as Record<string, unknown> | undefined)?.bot_id as
        | string
        | undefined);
    if (!id || !type) {
      throw new BadRequestException('Envelope inválido — id/event ausentes.');
    }
    return {
      id,
      type,
      botId,
      timestamp: typeof obj.timestamp === 'number' ? obj.timestamp : undefined,
      data: (obj.data as Record<string, unknown>) ?? {},
    };
  }

  /**
   * BAKE-OFF temporário — enfileira a comparação A/B de transcrição (um job por
   * provedor). Como o transcript (AssemblyAI ou MeetStream) só fica pronto
   * alguns minutos após a reunião, usamos backoff fixo longo: o processor
   * re-tenta enquanto o transcript não está disponível.
   * REMOVER junto com TranscricaoBench quando o provedor for decidido.
   */
  private async dispararBench(entrevistaId: string, botId: string): Promise<void> {
    const enfileiradoEm = Date.now();
    const opts = {
      attempts: 20,
      backoff: { type: 'fixed' as const, delay: 60_000 }, // re-tenta de 1 em 1 min, até ~20 min
    };
    await Promise.all([
      this.filaBench.add(
        'bench',
        { entrevistaId, provider: 'meetstream', botId, enfileiradoEm },
        { jobId: `bench-meetstream-${entrevistaId}`, ...opts },
      ),
      this.filaBench.add(
        'bench',
        { entrevistaId, provider: 'assemblyai', botId, enfileiradoEm },
        { jobId: `bench-assemblyai-${entrevistaId}`, ...opts },
      ),
    ]);
  }

  private async processar(evento: {
    type: string;
    botId?: string;
    timestamp?: number;
  }): Promise<void> {
    if (!evento.botId) {
      this.logger.warn(
        `MeetStream evento ${evento.type} sem bot_id — descartando.`,
      );
      return;
    }
    const entrevista = await this.prisma.entrevista.findFirst({
      where: { bot_session_id: evento.botId },
      select: { id: true, status: true, audio_url: true },
    });
    if (!entrevista) {
      this.logger.warn(
        `MeetStream evento ${evento.type} para bot ${evento.botId} sem entrevista correspondente.`,
      );
      return;
    }

    switch (evento.type) {
      case 'bot.joined':
        await this.prisma.entrevista.update({
          where: { id: entrevista.id },
          data: { bot_status: 'joined', iniciada_em: new Date() },
        });
        break;

      case 'bot.recording':
        await this.prisma.entrevista.update({
          where: { id: entrevista.id },
          data: { bot_status: 'recording' },
        });
        break;

      case 'bot.ended':
      case 'recording.ready':
        await this.prisma.entrevista.update({
          where: { id: entrevista.id },
          data: { bot_status: 'ended' },
        });
        if (!entrevista.audio_url) {
          await this.filaAudio.add(
            'baixar-audio',
            { entrevistaId: entrevista.id, botId: evento.botId },
            { jobId: `audio-${entrevista.id}` },
          );
        }
        // BAKE-OFF temporário (remover com TranscricaoBench): dispara a comparação
        // A/B. O lado 'assemblyai' lê o transcript que o pipeline acima produz; o
        // lado 'meetstream' busca o transcript interno do bot. Jobs idempotentes.
        await this.dispararBench(entrevista.id, evento.botId);
        break;

      case 'bot.failed':
        await this.prisma.entrevista.update({
          where: { id: entrevista.id },
          data: {
            bot_status: 'failed',
            status: 'CANCELADA',
            parecer_final: 'Bot MeetStream falhou — re-agende manualmente.',
          },
        });
        break;

      default:
        this.logger.debug(`Evento MeetStream não tratado: ${evento.type}`);
    }
  }
}
