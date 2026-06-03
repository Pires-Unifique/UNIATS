import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

import { AssemblyAIClient } from '../../assemblyai/assemblyai.client.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { QUEUE_NAMES } from '../../../queue/queue.module.js';

/**
 * Receiver do AssemblyAI Webhook.
 *
 * AssemblyAI envia um POST com body `{ transcript_id, status }`. Para validar,
 * usamos `webhook_auth_header_name/value` configurados na criação do job —
 * o header `X-Webhook-Secret` deve bater com `ASSEMBLYAI_WEBHOOK_SECRET`.
 *
 * Ao receber:
 *  - status=completed → busca transcript completo + utterances + sentiment,
 *    persiste em `transcricoes`, enfileira ANALISE_VOZ.
 *  - status=error → marca transcrição com erro, registra log.
 */
@Controller('webhooks/assemblyai')
export class AssemblyAIWebhookController {
  private readonly logger = new Logger(AssemblyAIWebhookController.name);

  constructor(
    private readonly assembly: AssemblyAIClient,
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_NAMES.ANALISE_VOZ)
    private readonly filaVoz: Queue,
  ) {}

  @Post()
  @HttpCode(202)
  async receber(
    @Headers('x-webhook-secret') secret: string | undefined,
    @Body() body: { transcript_id?: string; status?: string },
  ): Promise<{ status: string }> {
    if (!this.assembly.validarWebhookSecret(secret)) {
      throw new UnauthorizedException('Secret inválido.');
    }
    if (!body?.transcript_id || !body?.status) {
      throw new BadRequestException('transcript_id e status obrigatórios.');
    }
    const transcriptId = body.transcript_id;
    const eventoStatus = body.status;

    // Idempotência por (provider, external_id=transcriptId+status)
    try {
      await this.prisma.webhookRecebido.create({
        data: {
          provider: 'assemblyai',
          external_id: `${transcriptId}:${eventoStatus}`,
          evento: eventoStatus,
          payload: body as unknown as object,
          assinatura_ok: true,
          recebido_em: new Date(),
        },
      });
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        return { status: 'duplicate' };
      }
      throw err;
    }

    if (eventoStatus !== 'completed' && eventoStatus !== 'error') {
      // queued/processing — ignoramos.
      return { status: 'ignored' };
    }

    // Correlaciona transcript_id → entrevista_id
    const transcricao = await this.prisma.transcricao.findFirst({
      where: { provider_id: transcriptId },
      select: { id: true, entrevista_id: true },
    });
    if (!transcricao) {
      this.logger.warn(
        `AssemblyAI webhook para transcript_id=${transcriptId} sem registro local — descartando.`,
      );
      return { status: 'ignored' };
    }

    if (eventoStatus === 'error') {
      this.logger.error(
        `AssemblyAI marcou transcript ${transcriptId} como erro.`,
      );
      // Mantém o registro placeholder, mas zera segmentos.
      await this.prisma.transcricao.update({
        where: { id: transcricao.id },
        data: { texto_completo: '[transcrição falhou]', segmentos: {} },
      });
      return { status: 'error' };
    }

    // Busca detalhe completo
    const detalhe = await this.assembly.obterTranscricao(transcriptId);
    if (detalhe.status !== 'completed') {
      this.logger.warn(
        `Detalhe AssemblyAI veio com status=${detalhe.status} — re-tentaremos.`,
      );
      return { status: 'pending' };
    }

    const utterances = detalhe.utterances ?? [];
    const sentimentResults = detalhe.sentiment_analysis_results ?? [];

    await this.prisma.transcricao.update({
      where: { id: transcricao.id },
      data: {
        idioma: detalhe.language_code ?? 'pt-BR',
        texto_completo: (detalhe.text ?? '').slice(0, 1_000_000),
        segmentos: {
          utterances,
          sentimentResults,
          confidenceGlobal: detalhe.confidence,
          duracaoMs: detalhe.audio_duration,
        } as unknown as object,
      },
    });

    // Enfileira análise de voz
    await this.filaVoz.add(
      'analisar-voz',
      { entrevistaId: transcricao.entrevista_id },
      { jobId: `voz-${transcricao.entrevista_id}` },
    );

    this.logger.log(
      `Transcrição completa salva: entrevista=${transcricao.entrevista_id} ` +
        `texto=${(detalhe.text ?? '').length} chars utterances=${utterances.length}`,
    );

    return { status: 'ok' };
  }
}
