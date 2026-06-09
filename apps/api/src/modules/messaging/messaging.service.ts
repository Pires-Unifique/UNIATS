import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Prisma } from '@uniats/db';
import type { Queue } from 'bullmq';

import { PrismaService } from '../../prisma/prisma.service.js';
import { QUEUE_NAMES } from '../../queue/queue.module.js';
import { renderizarTemplateResolvido } from './templates/renderer.js';
import { TemplatesService } from './templates/templates.service.js';
import type {
  CanalSuportado,
  Variaveis,
} from './templates/template.types.js';

export interface EnfileirarMensagemInput {
  candidaturaId: string;
  /** Canal preferido. Worker faz fallback automático para outro se ENVIO falhar. */
  canal: CanalSuportado;
  templateCodigo: string;
  variaveis: Variaveis;
  /** Quando enviar (default: agora). */
  agendadoPara?: Date;
  /** Se true, autoriza fallback do WhatsApp para Email quando falhar. */
  permitirFallback?: boolean;
}

@Injectable()
export class MessagingService {
  private readonly logger = new Logger(MessagingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly templates: TemplatesService,
    @InjectQueue(QUEUE_NAMES.MENSAGEM) private readonly fila: Queue,
  ) {}

  async enfileirar(input: EnfileirarMensagemInput): Promise<{ mensagemId: string }> {
    // 1. Resolve o template do banco e valida variáveis ANTES de tocar o banco.
    //    `obterPorCodigo` lança NotFoundException se o template não existe/está inativo.
    const template = await this.templates.obterPorCodigo(input.templateCodigo);
    // Renderização "dry-run" para falhar cedo se faltar variável.
    renderizarTemplateResolvido({
      template,
      canal: input.canal,
      variaveis: input.variaveis,
    });

    // 2. Confere candidatura + dados de contato
    const candidatura = await this.prisma.candidatura.findUnique({
      where: { id: input.candidaturaId },
      select: {
        id: true,
        candidato_id: true,
        candidato: {
          select: {
            id: true,
            email: true,
            telefone: true,
            consentimento_lgpd_em: true,
            excluido_em: true,
          },
        },
      },
    });
    if (!candidatura) {
      throw new NotFoundException(
        `Candidatura ${input.candidaturaId} não existe.`,
      );
    }
    // Único bloqueio: candidato que pediu exclusão (LGPD Art. 18, III/VI).
    // O CONTATO em si NÃO exige consentimento prévio: ao se candidatar pela Gupy,
    // a pessoa pede o início do processo seletivo, o que ampara o contato como
    // "procedimentos preliminares relacionados a contrato a pedido do titular"
    // (LGPD Art. 7, V). O consentimento de GRAVAÇÃO é coletado no convite de
    // entrevista (ver template `agendamento_entrevista`).
    if (candidatura.candidato.excluido_em) {
      throw new BadRequestException(
        'Candidato pediu exclusão (LGPD) — não é permitido enviar mensagens.',
      );
    }

    const destino = this.escolherDestino(input.canal, candidatura.candidato);

    // 3. Persiste PENDENTE e enfileira
    const mensagem = await this.prisma.mensagem.create({
      data: {
        candidatura_id: input.candidaturaId,
        candidato_id: candidatura.candidato_id,
        canal: input.canal,
        direcao: 'SAIDA',
        template_codigo: `${template.codigo}@${template.versao}`,
        // Snapshot das variáveis (para auditoria) vai no JSONB do gupy_payload? Não — usamos `corpo`.
        corpo: this.serializarVariaveis(input.variaveis),
        destino,
        provider: input.canal === 'WHATSAPP' ? 'waha' : 'sendgrid',
        status: 'PENDENTE',
        agendado_para: input.agendadoPara,
      },
      select: { id: true },
    });

    const delay = input.agendadoPara
      ? Math.max(0, input.agendadoPara.getTime() - Date.now())
      : 0;

    await this.fila.add(
      'enviar-mensagem',
      {
        mensagemId: mensagem.id,
        canalPrimario: input.canal,
        permitirFallback: input.permitirFallback ?? true,
        templateCodigo: input.templateCodigo,
        variaveis: input.variaveis,
      },
      {
        jobId: `msg-${mensagem.id}`,
        delay,
      },
    );

    this.logger.log(
      `Mensagem enfileirada: id=${mensagem.id} canal=${input.canal} ` +
        `template=${template.codigo}@${template.versao}`,
    );

    return { mensagemId: mensagem.id };
  }

  async obter(id: string) {
    const m = await this.prisma.mensagem.findUnique({
      where: { id },
      select: {
        id: true,
        candidatura_id: true,
        canal: true,
        template_codigo: true,
        assunto: true,
        destino: true,
        provider: true,
        provider_msg_id: true,
        status: true,
        erro: true,
        enviado_em: true,
        entregue_em: true,
        lido_em: true,
        respondido_em: true,
        criado_em: true,
      },
    });
    if (!m) throw new NotFoundException(`Mensagem ${id} não existe.`);
    return m;
  }

  async listarPorCandidatura(candidaturaId: string) {
    return this.prisma.mensagem.findMany({
      where: { candidatura_id: candidaturaId },
      orderBy: { criado_em: 'desc' },
      take: 100,
      select: {
        id: true,
        canal: true,
        direcao: true,
        template_codigo: true,
        status: true,
        destino: true,
        enviado_em: true,
        lido_em: true,
        respondido_em: true,
        criado_em: true,
      },
    });
  }

  /**
   * Resolve as variáveis "padrão" de uma candidatura para a UI pré-preencher
   * o formulário de envio (candidato_nome, vaga_titulo, recrutador_nome).
   */
  async resolverContexto(candidaturaId: string): Promise<{
    candidato_nome: string;
    vaga_titulo: string;
    recrutador_nome: string | null;
  }> {
    const c = await this.prisma.candidatura.findUnique({
      where: { id: candidaturaId },
      select: {
        candidato: { select: { nome_completo: true } },
        vaga: {
          select: {
            titulo: true,
            recrutador: { select: { nome: true } },
          },
        },
      },
    });
    if (!c) {
      throw new NotFoundException(
        `Candidatura ${candidaturaId} não existe.`,
      );
    }
    return {
      candidato_nome: c.candidato.nome_completo,
      vaga_titulo: c.vaga.titulo,
      recrutador_nome: c.vaga.recrutador?.nome ?? null,
    };
  }

  /** ----------------------------------------------------------------------
   *  Métodos para o worker — atualizam status conforme o despacho ocorre.
   *  --------------------------------------------------------------------- */

  async marcarEnviado(
    mensagemId: string,
    providerMsgId: string,
    canal?: CanalSuportado,
    destino?: string,
    assunto?: string,
  ): Promise<void> {
    const data: Prisma.MensagemUncheckedUpdateInput = {
      status: 'ENVIADO',
      provider_msg_id: providerMsgId,
      enviado_em: new Date(),
      erro: null,
    };
    if (canal) data.canal = canal;
    if (destino) data.destino = destino;
    if (assunto != null) data.assunto = assunto;
    await this.prisma.mensagem.update({
      where: { id: mensagemId },
      data,
    });
  }

  async marcarFalha(mensagemId: string, erro: string): Promise<void> {
    await this.prisma.mensagem.update({
      where: { id: mensagemId },
      data: {
        status: 'FALHADO',
        erro: erro.slice(0, 2000),
      },
    });
  }

  /**
   * Atualiza status do delivery a partir de webhooks (entregue/lido/respondido).
   * Nunca regride status — só move "para frente".
   */
  async atualizarStatusWebhook(
    providerMsgId: string,
    novoStatus: 'ENVIADO' | 'ENTREGUE' | 'LIDO' | 'RESPONDIDO' | 'FALHADO',
    timestamp = new Date(),
  ): Promise<{ atualizou: boolean }> {
    const m = await this.prisma.mensagem.findFirst({
      where: { provider_msg_id: providerMsgId },
      select: { id: true, status: true },
    });
    if (!m) return { atualizou: false };

    const ordem: Record<string, number> = {
      PENDENTE: 0,
      ENVIADO: 1,
      ENTREGUE: 2,
      LIDO: 3,
      RESPONDIDO: 4,
      FALHADO: 99, // FALHADO é terminal mas pode vir tarde — não regride para ENTREGUE depois.
    };
    if (
      novoStatus !== 'FALHADO' &&
      ordem[m.status] >= ordem[novoStatus]
    ) {
      return { atualizou: false };
    }

    const campoTimestamp =
      novoStatus === 'ENTREGUE'
        ? { entregue_em: timestamp }
        : novoStatus === 'LIDO'
          ? { lido_em: timestamp }
          : novoStatus === 'RESPONDIDO'
            ? { respondido_em: timestamp }
            : {};

    await this.prisma.mensagem.update({
      where: { id: m.id },
      data: { status: novoStatus, ...campoTimestamp },
    });
    return { atualizou: true };
  }

  /** ----------------------------------------------------------------------
   *  Helpers internos
   *  --------------------------------------------------------------------- */

  private escolherDestino(
    canal: CanalSuportado,
    candidato: { email: string | null; telefone: string | null },
  ): string {
    if (canal === 'WHATSAPP') {
      if (!candidato.telefone) {
        throw new BadRequestException(
          'Candidato sem telefone — não é possível enviar via WhatsApp.',
        );
      }
      return candidato.telefone;
    }
    if (!candidato.email) {
      throw new BadRequestException(
        'Candidato sem e-mail — não é possível enviar via EMAIL.',
      );
    }
    return candidato.email;
  }

  private serializarVariaveis(variaveis: Variaveis): string {
    // Snapshot legível das variáveis usadas. Mantemos em `corpo` para auditoria
    // pré-render. O texto final renderizado entra após o envio (ENVIADO).
    return JSON.stringify(variaveis, null, 2).slice(0, 4000);
  }
}
