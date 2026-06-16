import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { z } from 'zod';

import { ClaudeService } from '../../claude/claude.service.js';
import { GraphClient } from '../../graph/graph.client.js';
import { parseVtt } from '../../graph/vtt.parser.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { QUEUE_NAMES } from '../../../queue/queue.module.js';

/**
 * Transcript oficial do Teams via Microsoft Graph (PULL — sem bot, sem callback).
 *
 * Fluxo: resolve onlineMeetingId pelo joinUrl (no contexto do organizador) →
 * lista os transcripts → baixa o VTT → parseia → grava `Transcricao` (provider
 * "graph") → Claude gera a ATA (resumo/tópicos). Idempotente.
 *
 * O Teams leva ~12 min indexando o transcript; por isso o job re-tenta com
 * backoff longo enquanto a reunião/transcript ainda não estão disponíveis.
 */
const PayloadSchema = z.object({
  entrevistaId: z.string().uuid(),
});

/** Sinaliza "ainda não pronto" → BullMQ re-tenta. */
class TranscriptIndisponivelError extends Error {}

@Processor(QUEUE_NAMES.TRANSCRICAO_GRAPH, {
  concurrency: Number(process.env.TRANSCRICAO_GRAPH_CONCURRENCY ?? 4),
})
export class TranscricaoGraphProcessor extends WorkerHost {
  private readonly logger = new Logger(TranscricaoGraphProcessor.name);
  private readonly retencaoDias: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly graph: GraphClient,
    private readonly claude: ClaudeService,
    private readonly config: ConfigService,
  ) {
    super();
    this.retencaoDias = Number(
      this.config.get<string>('RETENCAO_TRANSCRICAO_DIAS') ?? '365',
    );
  }

  async process(job: Job<unknown>): Promise<{ entrevistaId: string; ok: boolean }> {
    const parsed = PayloadSchema.safeParse(job.data);
    if (!parsed.success) throw new Error('Payload inválido para transcricao-graph.');
    const { entrevistaId } = parsed.data;

    if (!this.graph.enabled) {
      throw new Error('Graph não configurado (sem credenciais).');
    }

    const entrevista = await this.prisma.entrevista.findUnique({
      where: { id: entrevistaId },
      select: {
        id: true,
        teams_join_url: true,
        meet_url: true,
        entrevistador: { select: { email: true } },
        candidatura: {
          select: { vaga: { select: { recrutador: { select: { email: true } } } } },
        },
      },
    });
    if (!entrevista) throw new Error(`Entrevista ${entrevistaId} não existe.`);

    // Idempotência: já temos transcript do Graph com texto?
    const existente = await this.prisma.transcricao.findUnique({
      where: { entrevista_id: entrevistaId },
      select: { provider: true, texto_completo: true },
    });
    if (existente?.provider === 'graph' && existente.texto_completo.trim()) {
      return { entrevistaId, ok: true };
    }

    // Mesmo organizador usado no agendamento: a conta fixa tem prioridade
    // (é sob ela que o transcript existe no Graph).
    const organizador =
      this.config.get<string>('INTERVIEW_ORGANIZER_EMAIL') ??
      entrevista.candidatura.vaga?.recrutador?.email ??
      entrevista.entrevistador?.email ??
      this.config.get<string>('AGENDA_ORGANIZADOR_FALLBACK_EMAIL');
    if (!organizador) {
      throw new Error(
        `Entrevista ${entrevistaId} sem e-mail do organizador — não dá pra resolver a reunião no Graph.`,
      );
    }
    const joinUrl = entrevista.teams_join_url ?? entrevista.meet_url;
    if (!joinUrl) throw new Error(`Entrevista ${entrevistaId} sem joinUrl do Teams.`);

    // 1. joinUrl → onlineMeetingId
    const meetingId = await this.graph.resolverOnlineMeetingId(organizador, joinUrl);
    if (!meetingId) {
      throw new TranscriptIndisponivelError(
        `onlineMeeting não encontrado p/ entrevista ${entrevistaId} (organizador=${organizador}).`,
      );
    }

    // 2. lista transcripts (vazio enquanto o Teams indexa ~12 min)
    const transcripts = await this.graph.listarTranscripts(organizador, meetingId);
    if (transcripts.length === 0) {
      throw new TranscriptIndisponivelError(
        `Sem transcript ainda p/ meeting ${meetingId} — Teams indexando.`,
      );
    }
    // pega o mais recente (maior createdDateTime; senão o último)
    const escolhido = [...transcripts].sort((a, b) =>
      (a.criadoEm ?? '').localeCompare(b.criadoEm ?? ''),
    )[transcripts.length - 1];

    // 3. baixa o VTT
    const vtt = await this.graph.baixarTranscriptVtt(
      organizador,
      meetingId,
      escolhido.id,
    );
    if (!vtt) {
      throw new TranscriptIndisponivelError(
        `Conteúdo do transcript ${escolhido.id} ainda indisponível.`,
      );
    }

    // 4. parseia
    const { texto, segmentos } = parseVtt(vtt);
    if (!texto.trim()) {
      throw new TranscriptIndisponivelError(
        `VTT veio vazio p/ transcript ${escolhido.id}.`,
      );
    }

    // 5. persiste Transcricao (provider=graph) — sobrepõe qualquer placeholder
    const expira = new Date(Date.now() + this.retencaoDias * 24 * 3600_000);
    await this.prisma.transcricao.upsert({
      where: { entrevista_id: entrevistaId },
      create: {
        entrevista_id: entrevistaId,
        provider: 'graph',
        provider_id: escolhido.id,
        idioma: 'pt-BR',
        texto_completo: texto.slice(0, 1_000_000),
        segmentos: segmentos as unknown as object,
        expira_em: expira,
      },
      update: {
        provider: 'graph',
        provider_id: escolhido.id,
        texto_completo: texto.slice(0, 1_000_000),
        segmentos: segmentos as unknown as object,
        expira_em: expira,
      },
    });

    // 6. Claude → ATA (resumo + tópicos)
    const ata = await this.claude.gerarAtaReuniao(texto);
    await this.prisma.transcricao.update({
      where: { entrevista_id: entrevistaId },
      data: { resumo: ata.ata.resumo, topicos: ata.ata.topicos },
    });

    // 7. fecha a entrevista
    await this.prisma.entrevista.update({
      where: { id: entrevistaId },
      data: { status: 'FINALIZADA', finalizada_em: new Date() },
    });

    this.logger.log(
      `Transcript Graph ok: entrevista=${entrevistaId} segmentos=${segmentos.length} ` +
        `chars=${texto.length} transcriptId=${escolhido.id}`,
    );
    return { entrevistaId, ok: true };
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error): void {
    const naoPronto = err instanceof TranscriptIndisponivelError;
    this.logger.warn(
      `transcricao-graph falhou (job ${job?.id}, tentativa ${job?.attemptsMade}, naoPronto=${naoPronto}): ${err.message}`,
    );
  }
}
