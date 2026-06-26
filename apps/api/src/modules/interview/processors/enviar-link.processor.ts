import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { z } from 'zod';

import { PrismaService } from '../../../prisma/prisma.service.js';
import { WahaClient } from '../../waha/waha.client.js';
import type { WahaChatId } from '../../waha/waha.types.js';
import { QUEUE_NAMES } from '../../../queue/queue.module.js';

/**
 * Envia o LINK da call ao candidato por WhatsApp. Enfileirado por confirmarPorEnquete
 * com `delay` = max(0, início − 2h): o link só chega na janela de 2h antes (ou na
 * hora, se a confirmação foi de última hora). Idempotente (jobId `link-<entrevistaId>`);
 * não envia se a entrevista foi cancelada nesse meio-tempo.
 */
const PayloadSchema = z.object({ entrevistaId: z.string().uuid() });

function formatarDataHora(d: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(d);
}

@Processor(QUEUE_NAMES.ENVIAR_LINK_CANDIDATO, {
  concurrency: Number(process.env.ENVIAR_LINK_CONCURRENCY ?? 4),
})
export class EnviarLinkProcessor extends WorkerHost {
  private readonly logger = new Logger(EnviarLinkProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly waha: WahaClient,
  ) {
    super();
  }

  async process(job: Job<unknown>): Promise<{ entrevistaId: string; ok: boolean }> {
    const parsed = PayloadSchema.safeParse(job.data);
    if (!parsed.success) throw new Error('Payload inválido para enviar-link-candidato.');
    const { entrevistaId } = parsed.data;

    const e = await this.prisma.entrevista.findUnique({
      where: { id: entrevistaId },
      select: {
        status: true,
        teams_join_url: true,
        meet_url: true,
        agendada_para: true,
        candidatura_id: true,
        candidato_id: true,
        candidato: { select: { telefone: true, excluido_em: true } },
        candidatura: { select: { vaga: { select: { titulo: true } } } },
      },
    });
    if (!e) {
      this.logger.warn(`Envio do link: entrevista ${entrevistaId} não existe.`);
      return { entrevistaId, ok: false };
    }
    if (e.status === 'CANCELADA') {
      this.logger.log(`Envio do link: entrevista ${entrevistaId} cancelada — não envio.`);
      return { entrevistaId, ok: false };
    }
    if (e.candidato.excluido_em) {
      this.logger.log(`Envio do link: candidato excluído (LGPD) — não envio.`);
      return { entrevistaId, ok: false };
    }

    const joinUrl = e.teams_join_url ?? e.meet_url;
    const telefone = e.candidato.telefone;
    if (!joinUrl || !telefone) {
      this.logger.warn(
        `Envio do link: faltou joinUrl/telefone p/ entrevista ${entrevistaId}.`,
      );
      return { entrevistaId, ok: false };
    }

    const check = await this.waha.checkNumber(telefone);
    if (!check.numberExists || !check.chatId) {
      this.logger.warn(`Envio do link: número ${telefone} não existe no WhatsApp.`);
      return { entrevistaId, ok: false };
    }

    const titulo = e.candidatura?.vaga?.titulo ?? 'sua entrevista';
    const quando = formatarDataHora(e.agendada_para);
    const texto =
      `📅 Sua entrevista para *${titulo}* está chegando!\n\n` +
      `🗓️ *${quando}*\n` +
      `💻 Link da call: ${joinUrl}\n\n` +
      'É só clicar no link no horário. Até já!';

    await this.waha.sendText({
      chatId: check.chatId as WahaChatId,
      texto,
      linkPreview: false,
    });
    await this.prisma.mensagem.create({
      data: {
        candidatura_id: e.candidatura_id,
        candidato_id: e.candidato_id,
        canal: 'WHATSAPP',
        direcao: 'SAIDA',
        template_codigo: 'link_entrevista',
        corpo: texto,
        destino: check.chatId,
        provider: 'waha',
        status: 'ENVIADO',
        enviado_em: new Date(),
      },
    });

    this.logger.log(`Link enviado ao candidato: entrevista=${entrevistaId}.`);
    return { entrevistaId, ok: true };
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error): void {
    this.logger.warn(
      `enviar-link-candidato falhou (job ${job?.id}, tentativa ${job?.attemptsMade}): ${err.message}`,
    );
  }
}
