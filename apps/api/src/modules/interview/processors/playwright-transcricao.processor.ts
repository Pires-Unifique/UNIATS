import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { z } from 'zod';

import { ClaudeService } from '../../claude/claude.service.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { QUEUE_NAMES } from '../../../queue/queue.module.js';

/**
 * Persiste a transcrição capturada pelo bot Playwright (legendas do Teams web) e
 * gera a ATA via Claude — mesmo destino do pull do Graph.
 *
 * Orquestração Graph×Playwright: o Playwright é a rede de segurança que captura
 * AO VIVO. Se já existe um transcript do Graph (oficial, melhor qualidade), NÃO
 * sobrescrevemos — o Graph é o vencedor. O caminho inverso (Graph sobrepor o
 * playwright depois) é desejado e tratado no processor do Graph.
 */
const PayloadSchema = z.object({
  entrevistaId: z.string().uuid(),
  texto: z.string().min(1),
  segmentos: z
    .array(
      z.object({
        inicio_ms: z.number().int().nonnegative(),
        falante: z.string(),
        texto: z.string(),
      }),
    )
    .default([]),
});

@Processor(QUEUE_NAMES.PLAYWRIGHT_TRANSCRICAO, {
  concurrency: Number(process.env.PLAYWRIGHT_TRANSCRICAO_CONCURRENCY ?? 2),
})
export class PlaywrightTranscricaoProcessor extends WorkerHost {
  private readonly logger = new Logger(PlaywrightTranscricaoProcessor.name);
  private readonly retencaoDias: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly claude: ClaudeService,
    config: ConfigService,
  ) {
    super();
    this.retencaoDias = Number(
      config.get<string>('RETENCAO_TRANSCRICAO_DIAS') ?? '365',
    );
  }

  async process(job: Job<unknown>): Promise<{ entrevistaId: string; ok: boolean }> {
    const parsed = PayloadSchema.safeParse(job.data);
    if (!parsed.success) throw new Error('Payload inválido para playwright-transcricao.');
    const { entrevistaId, texto, segmentos } = parsed.data;

    const entrevista = await this.prisma.entrevista.findUnique({
      where: { id: entrevistaId },
      select: { id: true, status: true },
    });
    if (!entrevista) throw new Error(`Entrevista ${entrevistaId} não existe.`);

    // Anti-downgrade: se já há transcript do Graph com texto, ele vence.
    const existente = await this.prisma.transcricao.findUnique({
      where: { entrevista_id: entrevistaId },
      select: { provider: true, texto_completo: true },
    });
    if (existente?.provider === 'graph' && existente.texto_completo.trim()) {
      this.logger.log(
        `Playwright ignorado p/ entrevista ${entrevistaId}: já há transcript do Graph (melhor).`,
      );
      await this.marcarBotEncerrado(entrevistaId);
      return { entrevistaId, ok: true };
    }

    const expira = new Date(Date.now() + this.retencaoDias * 24 * 3600_000);
    await this.prisma.transcricao.upsert({
      where: { entrevista_id: entrevistaId },
      create: {
        entrevista_id: entrevistaId,
        provider: 'playwright',
        idioma: 'pt-BR',
        texto_completo: texto.slice(0, 1_000_000),
        segmentos: segmentos as unknown as object,
        expira_em: expira,
      },
      update: {
        provider: 'playwright',
        texto_completo: texto.slice(0, 1_000_000),
        segmentos: segmentos as unknown as object,
        expira_em: expira,
      },
    });

    // Claude → ATA (resumo + tópicos).
    const ata = await this.claude.gerarAtaReuniao(texto);
    await this.prisma.transcricao.update({
      where: { entrevista_id: entrevistaId },
      data: { resumo: ata.ata.resumo, topicos: ata.ata.topicos },
    });

    await this.prisma.entrevista.update({
      where: { id: entrevistaId },
      data: { status: 'FINALIZADA', finalizada_em: new Date(), bot_status: 'ended' },
    });

    this.logger.log(
      `Transcript Playwright ok: entrevista=${entrevistaId} segmentos=${segmentos.length} ` +
        `chars=${texto.length}`,
    );
    return { entrevistaId, ok: true };
  }

  private async marcarBotEncerrado(entrevistaId: string): Promise<void> {
    await this.prisma.entrevista
      .update({ where: { id: entrevistaId }, data: { bot_status: 'ended' } })
      .catch(() => undefined);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error): void {
    this.logger.warn(
      `playwright-transcricao falhou (job ${job?.id}, tentativa ${job?.attemptsMade}): ${err.message}`,
    );
  }
}
