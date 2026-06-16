import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { z } from 'zod';

import { ClaudeService } from '../../claude/claude.service.js';
import {
  MeetStreamClient,
  type TranscriptSegmento,
} from '../../meetstream/meetstream.client.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { QUEUE_NAMES } from '../../../queue/queue.module.js';

/**
 * ⚠️ BAKE-OFF TEMPORÁRIO — REMOVER quando o provedor de transcrição for decidido.
 *
 * Para a MESMA entrevista, monta uma linha de `TranscricaoBench` por provedor:
 *   - meetstream → busca o transcript interno do MeetStream (obterTranscript).
 *   - assemblyai → lê o transcript já produzido pelo pipeline de produção
 *                  (tabela `transcricoes`); se ainda não chegou, re-tenta.
 * Em ambos os casos roda a MESMA ATA do Claude (gerarAtaReuniao), de modo que
 * a comparação isole a qualidade da TRANSCRIÇÃO. Mede palavras, segmentos,
 * latência de disponibilização e tokens da ATA.
 */
const PayloadSchema = z.object({
  entrevistaId: z.string().uuid(),
  provider: z.enum(['assemblyai', 'meetstream']),
  botId: z.string().min(1).optional(),
  /** Date.now() do momento em que o webhook bot.ended disparou os jobs. */
  enfileiradoEm: z.number().int().positive().optional(),
});
export type TranscricaoBenchPayload = z.infer<typeof PayloadSchema>;

/** Erro de "ainda não pronto" — sinaliza ao BullMQ para re-tentar com backoff. */
class TranscriptIndisponivelError extends Error {}

@Processor(QUEUE_NAMES.TRANSCRICAO_BENCH, {
  concurrency: Number(process.env.TRANSCRICAO_BENCH_CONCURRENCY ?? 2),
})
export class TranscricaoBenchProcessor extends WorkerHost {
  private readonly logger = new Logger(TranscricaoBenchProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly meetstream: MeetStreamClient,
    private readonly claude: ClaudeService,
    private readonly config: ConfigService,
  ) {
    super();
  }

  async process(job: Job<unknown>): Promise<{ provider: string; ok: boolean }> {
    const parsed = PayloadSchema.safeParse(job.data);
    if (!parsed.success) {
      throw new Error('Payload inválido para transcricao-bench.');
    }
    const { entrevistaId, provider, botId, enfileiradoEm } = parsed.data;

    // Idempotência: se essa linha já está 'ok', não refaz.
    const existente = await this.prisma.transcricaoBench.findUnique({
      where: {
        entrevista_id_provider: { entrevista_id: entrevistaId, provider },
      },
      select: { id: true, status: true },
    });
    if (existente?.status === 'ok') {
      return { provider, ok: true };
    }

    // 1. Obtém o transcript do provedor.
    const { texto, segmentos, providerRef } = await this.obterTranscript(
      provider,
      entrevistaId,
      botId,
    );

    // 2. Gera a ATA (mesmo prompt nos dois lados).
    const ata = await this.claude.gerarAtaReuniao(texto);

    // 3. Métricas de eficiência.
    const palavras = texto.split(/\s+/).filter(Boolean).length;
    const latenciaMs = enfileiradoEm
      ? Math.max(0, Date.now() - enfileiradoEm)
      : null;

    // 4. Persiste a linha de comparação.
    await this.prisma.transcricaoBench.upsert({
      where: {
        entrevista_id_provider: { entrevista_id: entrevistaId, provider },
      },
      create: {
        entrevista_id: entrevistaId,
        provider,
        status: 'ok',
        idioma: 'pt-BR',
        texto_completo: texto.slice(0, 1_000_000),
        segmentos: segmentos as unknown as object,
        resumo: ata.ata.resumo,
        topicos: ata.ata.topicos,
        palavras,
        segmentos_count: segmentos.length,
        latencia_ms: latenciaMs,
        tokens_entrada: ata.tokensEntrada,
        tokens_saida: ata.tokensSaida,
        provider_ref: providerRef,
        erro: null,
      },
      update: {
        status: 'ok',
        texto_completo: texto.slice(0, 1_000_000),
        segmentos: segmentos as unknown as object,
        resumo: ata.ata.resumo,
        topicos: ata.ata.topicos,
        palavras,
        segmentos_count: segmentos.length,
        latencia_ms: latenciaMs,
        tokens_entrada: ata.tokensEntrada,
        tokens_saida: ata.tokensSaida,
        provider_ref: providerRef,
        erro: null,
      },
    });

    this.logger.log(
      `Bench ${provider} ok: entrevista=${entrevistaId} palavras=${palavras} ` +
        `segmentos=${segmentos.length} latencia=${latenciaMs ?? '?'}ms`,
    );
    return { provider, ok: true };
  }

  /** Busca o transcript conforme o provedor. Lança TranscriptIndisponivelError se ainda não pronto. */
  private async obterTranscript(
    provider: 'assemblyai' | 'meetstream',
    entrevistaId: string,
    botId?: string,
  ): Promise<{
    texto: string;
    segmentos: TranscriptSegmento[];
    providerRef?: string;
  }> {
    if (provider === 'meetstream') {
      if (!botId) {
        throw new Error('Bench meetstream sem botId.');
      }
      const meta = await this.meetstream.obterTranscript(botId);
      if (!meta || !meta.texto.trim()) {
        throw new TranscriptIndisponivelError(
          `Transcript MeetStream ainda indisponível para bot ${botId}.`,
        );
      }
      return { texto: meta.texto, segmentos: meta.segmentos, providerRef: botId };
    }

    // assemblyai: lê o transcript de produção (tabela `transcricoes`).
    const t = await this.prisma.transcricao.findUnique({
      where: { entrevista_id: entrevistaId },
      select: { texto_completo: true, segmentos: true, provider_id: true },
    });
    if (!t || !t.texto_completo.trim()) {
      throw new TranscriptIndisponivelError(
        `Transcript AssemblyAI ainda indisponível para entrevista ${entrevistaId}.`,
      );
    }
    return {
      texto: t.texto_completo,
      segmentos: this.segmentosDeAssembly(t.segmentos),
      providerRef: t.provider_id ?? undefined,
    };
  }

  /** Converte os `segmentos` do AssemblyAI (utterances) ao shape normalizado. */
  private segmentosDeAssembly(seg: unknown): TranscriptSegmento[] {
    const utterances = (seg as { utterances?: unknown })?.utterances;
    if (!Array.isArray(utterances)) return [];
    return utterances
      .map((u): TranscriptSegmento | null => {
        if (!u || typeof u !== 'object') return null;
        const o = u as Record<string, unknown>;
        const texto = String(o.text ?? '').trim();
        if (!texto) return null;
        return {
          texto,
          falante: o.speaker != null ? String(o.speaker) : undefined,
          inicio_ms: typeof o.start === 'number' ? o.start : undefined,
          fim_ms: typeof o.end === 'number' ? o.end : undefined,
        };
      })
      .filter((s): s is TranscriptSegmento => s !== null);
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job, err: Error): Promise<void> {
    const naoPronto = err instanceof TranscriptIndisponivelError;
    this.logger.warn(
      `bench falhou (job ${job?.id}, tentativa ${job?.attemptsMade}, naoPronto=${naoPronto}): ${err.message}`,
    );
    // Só grava linha de erro quando esgotou as tentativas (não a cada retry).
    const tentativas = job?.opts?.attempts ?? 0;
    if (job?.attemptsMade && tentativas && job.attemptsMade >= tentativas) {
      const data = PayloadSchema.safeParse(job.data);
      if (data.success) {
        await this.prisma.transcricaoBench
          .upsert({
            where: {
              entrevista_id_provider: {
                entrevista_id: data.data.entrevistaId,
                provider: data.data.provider,
              },
            },
            create: {
              entrevista_id: data.data.entrevistaId,
              provider: data.data.provider,
              status: 'erro',
              erro: err.message.slice(0, 1000),
            },
            update: { status: 'erro', erro: err.message.slice(0, 1000) },
          })
          .catch((e) =>
            this.logger.error(`Falha ao gravar erro de bench: ${e.message}`),
          );
      }
    }
  }
}
