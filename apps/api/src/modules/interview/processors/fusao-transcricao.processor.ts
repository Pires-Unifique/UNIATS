import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { z } from 'zod';

import { ClaudeService } from '../../claude/claude.service.js';
import { NotificacoesService } from '../../notificacoes/notificacoes.service.js';
import { RespostasEntrevistaService } from '../../questions/respostas-entrevista.service.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { QUEUE_NAMES } from '../../../queue/queue.module.js';

/**
 * Fusão das duas transcrições da mesma entrevista numa "melhor versão".
 *
 * Disparada (com debounce) pelos processors do Graph e do Playwright ao gravarem
 * suas partes. Só funde quando AS DUAS fontes estão presentes:
 *   - `segmentos`         → Teams/legenda (diarizado: quem falou)
 *   - `whisper_segmentos` → Whisper (PT mais fiel, sem inglês alucinado)
 *
 * O Claude reconcilia (ClaudeService.fundirTranscricoes); gravamos `texto_fundido`
 * + `segmentos_fundidos` (o que o usuário passa a ver) e regeneramos a ATA a partir
 * do texto fundido. Se faltar uma das fontes, sai sem erro — o outro processor
 * dispara de novo quando a parte que falta chegar.
 */
const PayloadSchema = z.object({ entrevistaId: z.string().uuid() });

type Seg = { falante?: string | null; texto?: string | null };

@Processor(QUEUE_NAMES.FUSAO_TRANSCRICAO, {
  concurrency: Number(process.env.FUSAO_CONCURRENCY ?? 1),
  // A fusão chama o Claude com output longo (~min). Lock generoso p/ o BullMQ não
  // considerar o job "travado" e reprocessar no meio da chamada.
  lockDuration: 10 * 60_000,
})
export class FusaoTranscricaoProcessor extends WorkerHost {
  private readonly logger = new Logger(FusaoTranscricaoProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly claude: ClaudeService,
    private readonly respostas: RespostasEntrevistaService,
    private readonly notificacoes: NotificacoesService,
  ) {
    super();
  }

  async process(job: Job<unknown>): Promise<{ entrevistaId: string; ok: boolean }> {
    const parsed = PayloadSchema.safeParse(job.data);
    if (!parsed.success) throw new Error('Payload inválido para fusao-transcricao.');
    const { entrevistaId } = parsed.data;

    const t = await this.prisma.transcricao.findUnique({
      where: { entrevista_id: entrevistaId },
      select: { segmentos: true, whisper_segmentos: true },
    });
    if (!t) {
      this.logger.warn(`Fusão: transcrição inexistente p/ entrevista ${entrevistaId}.`);
      return { entrevistaId, ok: false };
    }

    const teams = ((t.segmentos as Seg[] | null) ?? [])
      .filter((s) => s?.texto?.trim())
      .map((s) => ({ falante: s.falante ?? 'Desconhecido', texto: String(s.texto) }));
    const whisper = ((t.whisper_segmentos as Seg[] | null) ?? [])
      .filter((s) => s?.texto?.trim())
      .map((s) => ({ texto: String(s.texto) }));

    if (teams.length === 0 || whisper.length === 0) {
      this.logger.log(
        `Fusão adiada p/ entrevista ${entrevistaId}: faltam fontes ` +
          `(teams=${teams.length} whisper=${whisper.length}).`,
      );
      return { entrevistaId, ok: false };
    }

    const fusao = await this.claude.fundirTranscricoes({ teams, whisper });

    // ATA do TEXTO FUNDIDO (resumo melhor que o de qualquer fonte isolada).
    // Best-effort: se falhar, mantém o resumo anterior.
    const ata = await this.claude.gerarAtaReuniao(fusao.texto).catch((err) => {
      this.logger.warn(`ATA do texto fundido falhou (não crítico): ${(err as Error).message}`);
      return null;
    });

    await this.prisma.transcricao.update({
      where: { entrevista_id: entrevistaId },
      data: {
        texto_fundido: fusao.texto.slice(0, 1_000_000),
        segmentos_fundidos: fusao.turnos as unknown as object,
        fusao_em: new Date(),
        ...(ata ? { resumo: ata.ata.resumo, topicos: ata.ata.topicos } : {}),
      },
    });

    this.logger.log(
      `Fusão ok: entrevista=${entrevistaId} turnos=${fusao.turnos.length} ` +
        `chars=${fusao.texto.length} (teams=${teams.length} whisper=${whisper.length})`,
    );

    // Análise das respostas do roteiro sobre o texto fundido. Best-effort: sem
    // perguntas cadastradas/geradas (BadRequest) ou LLM fora, só loga — a tela
    // tem o botão "Analisar respostas" para reprocessar depois.
    const analiseOk = await this.respostas
      .analisar(entrevistaId)
      .then(() => true)
      .catch((err) => {
        this.logger.warn(
          `Análise de respostas pós-fusão falhou (não crítico): ${(err as Error).message}`,
        );
        return false;
      });

    // Notifica recrutador + gestor SÓ quando a análise automática concluiu. O
    // botão "Analisar respostas" (reprocesso manual na tela) não passa por aqui,
    // então não gera aviso para quem já está olhando a entrevista.
    if (analiseOk) {
      await this.notificacoes.notificarAnalisePronta(entrevistaId);
    }

    return { entrevistaId, ok: true };
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error): void {
    this.logger.warn(
      `fusao-transcricao falhou (job ${job?.id}, tentativa ${job?.attemptsMade}): ${err.message}`,
    );
  }
}
