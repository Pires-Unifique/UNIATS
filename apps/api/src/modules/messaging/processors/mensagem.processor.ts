import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { DelayedError, type Job } from 'bullmq';
import { z } from 'zod';

import { MessagingService } from '../messaging.service.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { QUEUE_NAMES } from '../../../queue/queue.module.js';
import { SendGridClient } from '../../sendgrid/sendgrid.client.js';
import { WahaClient } from '../../waha/waha.client.js';
import { renderizarTemplateResolvido } from '../templates/renderer.js';
import { TemplatesService } from '../templates/templates.service.js';
import { WhatsappPacerService } from '../whatsapp-pacer.service.js';

const PayloadSchema = z.object({
  mensagemId: z.string().uuid(),
  canalPrimario: z.enum(['WHATSAPP', 'EMAIL']),
  permitirFallback: z.boolean().default(true),
  templateCodigo: z.string().min(1),
  variaveis: z.record(z.string(), z.union([z.string(), z.number()])),
});
export type MensagemPayload = z.infer<typeof PayloadSchema>;

@Processor(QUEUE_NAMES.MENSAGEM, {
  concurrency: Number(process.env.MENSAGEM_CONCURRENCY ?? 2),
})
export class MensagemProcessor extends WorkerHost {
  private readonly logger = new Logger(MensagemProcessor.name);

  constructor(
    private readonly messaging: MessagingService,
    private readonly templates: TemplatesService,
    private readonly waha: WahaClient,
    private readonly sendgrid: SendGridClient,
    private readonly prisma: PrismaService,
    private readonly pacer: WhatsappPacerService,
  ) {
    super();
  }

  async process(job: Job<unknown>, token?: string): Promise<{
    mensagemId: string;
    canal: 'WHATSAPP' | 'EMAIL';
    providerMsgId: string;
  }> {
    const parsed = PayloadSchema.safeParse(job.data);
    if (!parsed.success) {
      this.logger.error(
        `Payload inválido em mensagem (job ${job.id}): ${parsed.error.message}`,
      );
      throw new Error('Payload inválido para mensagem.');
    }
    const {
      mensagemId,
      canalPrimario,
      permitirFallback,
      templateCodigo,
      variaveis,
    } = parsed.data;

    // Carrega mensagem + dados de contato no momento do envio (telefone/email podem ter sido atualizados)
    const m = await this.prisma.mensagem.findUnique({
      where: { id: mensagemId },
      select: {
        id: true,
        status: true,
        candidato: {
          select: {
            id: true,
            nome_completo: true,
            email: true,
            telefone: true,
            excluido_em: true,
          },
        },
      },
    });
    if (!m) {
      throw new Error(`Mensagem ${mensagemId} não existe (race condition?).`);
    }
    if (m.candidato.excluido_em) {
      await this.messaging.marcarFalha(
        mensagemId,
        'Candidato excluído por LGPD após enfileirar — envio cancelado.',
      );
      throw new Error('Candidato excluído — envio cancelado.');
    }
    if (m.status !== 'PENDENTE') {
      // Job duplicado / re-tentativa após sucesso — não reenvia.
      this.logger.warn(
        `Mensagem ${mensagemId} já está no estado ${m.status} — pulando envio.`,
      );
      return {
        mensagemId,
        canal: canalPrimario,
        providerMsgId: '(ja-enviada)',
      };
    }

    // PACING anti-banimento: fora da janela de envio ou acima do teto diário,
    // reagenda o job para a próxima abertura SEM consumir tentativa (padrão
    // moveToDelayed + DelayedError do BullMQ). Só vale para o canal WhatsApp.
    if (canalPrimario === 'WHATSAPP') {
      const decisao = await this.pacer.avaliarJanelaECap();
      if (!decisao.liberado) {
        this.logger.log(
          `Mensagem ${mensagemId} adiada (${decisao.motivo}) — retoma em ${decisao.retomarEm.toISOString()}.`,
        );
        await job.moveToDelayed(decisao.retomarEm.getTime(), token);
        throw new DelayedError();
      }
    }

    // Tenta canal primário; se falhar de forma "permanente" (BadRequest do provider)
    // e fallback habilitado + outro canal disponível → tenta o oposto.
    try {
      const r = await this.despachar(
        canalPrimario,
        templateCodigo,
        variaveis,
        m.candidato,
      );
      await this.messaging.marcarEnviado(
        mensagemId,
        r.providerMsgId,
        canalPrimario,
        r.destino,
        r.assunto,
      );
      return { mensagemId, canal: canalPrimario, providerMsgId: r.providerMsgId };
    } catch (errPrimario) {
      const ePrim = errPrimario as Error & { status?: number };
      this.logger.warn(
        `Envio ${canalPrimario} falhou para mensagem ${mensagemId}: ${ePrim.message}`,
      );

      const podeFallback =
        permitirFallback &&
        this.deveTentarFallback(ePrim) &&
        this.canalAlternativo(canalPrimario, m.candidato) !== null;

      if (!podeFallback) {
        // Erro recuperável? Deixa o BullMQ retentar.
        if (this.eRecuperavel(ePrim)) {
          throw ePrim;
        }
        await this.messaging.marcarFalha(
          mensagemId,
          `Falha definitiva (${canalPrimario}): ${ePrim.message}`,
        );
        throw ePrim;
      }

      const canalAlt = this.canalAlternativo(canalPrimario, m.candidato)!;
      this.logger.log(
        `Fallback ${canalPrimario}→${canalAlt} para mensagem ${mensagemId}.`,
      );
      try {
        const r = await this.despachar(
          canalAlt,
          templateCodigo,
          variaveis,
          m.candidato,
        );
        await this.messaging.marcarEnviado(
          mensagemId,
          r.providerMsgId,
          canalAlt,
          r.destino,
          r.assunto,
        );
        return { mensagemId, canal: canalAlt, providerMsgId: r.providerMsgId };
      } catch (errFb) {
        const eFb = errFb as Error;
        if (this.eRecuperavel(eFb)) {
          throw eFb; // BullMQ retenta
        }
        await this.messaging.marcarFalha(
          mensagemId,
          `Falha em ambos os canais. Primário: ${ePrim.message}. Fallback: ${eFb.message}`,
        );
        throw eFb;
      }
    }
  }

  /** ----------------------------------------------------------------------
   *  Internos
   *  --------------------------------------------------------------------- */

  private async despachar(
    canal: 'WHATSAPP' | 'EMAIL',
    templateCodigo: string,
    variaveis: Record<string, string | number>,
    candidato: {
      id: string;
      nome_completo: string | null;
      email: string | null;
      telefone: string | null;
    },
  ): Promise<{
    providerMsgId: string;
    destino: string;
    assunto?: string;
  }> {
    // Resolve o template do banco no momento do envio. Se foi desabilitado/removido
    // após o enfileiramento, lança NotFoundException → tratado como falha não-recuperável.
    const template = await this.templates.obterPorCodigo(templateCodigo);
    const render = renderizarTemplateResolvido({
      template,
      canal,
      variaveis,
    });

    if (canal === 'WHATSAPP') {
      if (!candidato.telefone) {
        throw new Error('Candidato sem telefone (no momento do envio).');
      }
      const check = await this.waha.checkNumber(candidato.telefone);
      if (!check.numberExists || !check.chatId) {
        throw new Error(
          `Número ${candidato.telefone} não existe no WhatsApp.`,
        );
      }
      // Reforços anti-banimento: contato salvo antes do 1º envio (best-effort)
      // e intervalo aleatório entre envios consecutivos (fim da rajada).
      await this.pacer.salvarContatoSeNovo(
        candidato.id,
        check.chatId,
        candidato.nome_completo,
      );
      await this.pacer.aguardarVez();
      const out = await this.waha.sendText({
        chatId: check.chatId,
        texto: render.texto,
      });
      return {
        providerMsgId: out.messageId,
        destino: check.chatId,
      };
    }

    // EMAIL
    if (!candidato.email) {
      throw new Error('Candidato sem e-mail (no momento do envio).');
    }
    const out = await this.sendgrid.enviarEmail({
      para: candidato.email,
      assunto: render.assunto!,
      textoPlano: render.texto,
      html: render.html,
    });
    return {
      providerMsgId: out.messageId,
      destino: candidato.email,
      assunto: render.assunto,
    };
  }

  private canalAlternativo(
    canal: 'WHATSAPP' | 'EMAIL',
    candidato: { email: string | null; telefone: string | null },
  ): 'WHATSAPP' | 'EMAIL' | null {
    if (canal === 'WHATSAPP') return candidato.email ? 'EMAIL' : null;
    return candidato.telefone ? 'WHATSAPP' : null;
  }

  /**
   * Falha de validação 4xx do provider = não tentar de novo no mesmo canal.
   * Geralmente sinaliza "número não existe", "e-mail bounce permanente", etc.
   */
  private deveTentarFallback(err: { status?: number; message?: string }): boolean {
    const msg = err.message ?? '';
    if (/não existe no WhatsApp|inválido|bounce/i.test(msg)) return true;
    const status = err.status ?? (err as any)?.response?.status;
    return status === 400 || status === 404 || status === 422;
  }

  private eRecuperavel(err: { status?: number; message?: string }): boolean {
    const status = err.status ?? (err as any)?.response?.status;
    if (status === 429 || (status && status >= 500)) return true;
    return /timeout|ECONN|ETIMEDOUT|ServiceUnavailable/i.test(err.message ?? '');
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error): void {
    this.logger.error(
      `mensagem falhou (job ${job?.id}, tentativa ${job?.attemptsMade}): ${err.message}`,
    );
  }
}
