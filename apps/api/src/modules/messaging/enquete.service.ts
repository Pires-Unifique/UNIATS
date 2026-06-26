import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { Prisma } from '@uniats/db';

import { PrismaService } from '../../prisma/prisma.service.js';
import { WahaClient } from '../waha/waha.client.js';
import { GraphClient } from '../graph/graph.client.js';
import { QUEUE_NAMES } from '../../queue/queue.module.js';

export interface OpcaoHorario {
  /** Texto exato exibido na opção da enquete (casa com o voto). */
  rotulo: string;
  /** ISO-8601 do início. */
  inicio: string;
  /** ISO-8601 do fim. */
  fim: string;
}

export interface EnviarEnqueteHorariosInput {
  candidaturaId: string;
  opcoes: OpcaoHorario[];
  /** Pergunta da enquete (default amigável com o título da vaga). */
  pergunta?: string;
}

/**
 * Converte um horário "ISO local" (sem timezone, ex.: "2026-06-22T10:30:00",
 * como o front gera via `isoLocal`) para Date interpretando-o no fuso de
 * Brasília (UTC−3 fixo — o Brasil não tem horário de verão desde 2019).
 * Strings que JÁ trazem offset (`Z` ou `±hh:mm`) são respeitadas.
 *
 * Sem isto, `new Date(s)` no servidor (que roda em UTC) trataria a hora de
 * Brasília como UTC, jogando o horário 3h para trás — fazendo um horário futuro
 * (ex.: 10:30 BRT) parecer "já passou".
 */
export function parseHorarioBrasil(s: string): Date {
  const t = s.trim();
  return /(?:z|[+-]\d{2}:?\d{2})$/i.test(t) ? new Date(t) : new Date(`${t}-03:00`);
}

/**
 * Enquete de horários: envia uma ENQUETE (poll) do WhatsApp com 2–12 opções de
 * horário para o candidato votar. O voto chega pelo webhook `poll.vote` e é
 * casado de volta com a opção (→ início/fim) para o recrutador agendar.
 */
@Injectable()
export class EnqueteService {
  private readonly logger = new Logger(EnqueteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly waha: WahaClient,
    private readonly graph: GraphClient,
    @InjectQueue(QUEUE_NAMES.CONFIRMAR_ENQUETE)
    private readonly filaConfirmar: Queue,
  ) {}

  async enviar(input: EnviarEnqueteHorariosInput): Promise<{
    enqueteId: string;
    providerMsgId: string;
    opcoes: number;
  }> {
    const opcoes = (input.opcoes ?? []).filter(
      (o) => o?.rotulo?.trim() && o?.inicio && o?.fim,
    );
    if (opcoes.length < 2 || opcoes.length > 12) {
      throw new BadRequestException(
        'Selecione entre 2 e 12 horários para a enquete.',
      );
    }
    const rotulos = opcoes.map((o) => o.rotulo.trim());
    if (new Set(rotulos).size !== rotulos.length) {
      throw new BadRequestException('Os horários (rótulos) devem ser únicos.');
    }
    for (const o of opcoes) {
      if (Number.isNaN(new Date(o.inicio).getTime()) || Number.isNaN(new Date(o.fim).getTime())) {
        throw new BadRequestException('Opção com data inválida.');
      }
    }

    const candidatura = await this.prisma.candidatura.findUnique({
      where: { id: input.candidaturaId },
      select: {
        id: true,
        candidato_id: true,
        candidato: {
          select: { telefone: true, excluido_em: true, nome_completo: true },
        },
        // Participantes cujas agendas serão pré-reservadas (recrutador + gestor da
        // vaga). O bloqueio é SEMPRE na agenda dessas pessoas — nunca na conta de
        // serviço/bot que organiza a reunião.
        vaga: {
          select: {
            titulo: true,
            recrutador: { select: { email: true } },
            gestor: { select: { email: true } },
          },
        },
      },
    });
    if (!candidatura) {
      throw new NotFoundException(
        `Candidatura ${input.candidaturaId} não existe.`,
      );
    }
    if (candidatura.candidato.excluido_em) {
      throw new BadRequestException(
        'Candidato pediu exclusão (LGPD) — não é permitido enviar enquete.',
      );
    }
    if (!candidatura.candidato.telefone) {
      throw new BadRequestException(
        'Candidato sem telefone — a enquete só é enviada por WhatsApp.',
      );
    }

    const pergunta =
      input.pergunta?.trim() ||
      `Qual horário fica melhor para sua entrevista${candidatura.vaga?.titulo ? ` (${candidatura.vaga.titulo})` : ''}?`;

    // Resolve o chatId canônico (trata o "9" extra dos números BR).
    const check = await this.waha.checkNumber(candidatura.candidato.telefone);
    if (!check.numberExists || !check.chatId) {
      throw new BadRequestException(
        `Número ${candidatura.candidato.telefone} não existe no WhatsApp.`,
      );
    }

    const enviado = await this.waha.sendPoll({
      chatId: check.chatId,
      pergunta,
      opcoes: rotulos,
    });

    // Encerra enquetes anteriores ainda aguardando resposta (evita ambiguidade).
    await this.prisma.enqueteHorario.updateMany({
      where: { candidatura_id: input.candidaturaId, status: 'AGUARDANDO' },
      data: { status: 'CANCELADA' },
    });

    const enquete = await this.prisma.enqueteHorario.create({
      data: {
        candidatura_id: input.candidaturaId,
        candidato_id: candidatura.candidato_id,
        canal: 'WHATSAPP',
        provider: 'waha',
        provider_msg_id: enviado.messageId,
        pergunta,
        opcoes: opcoes as unknown as Prisma.InputJsonValue,
        status: 'AGUARDANDO',
      },
      select: { id: true },
    });

    // PRÉ-RESERVA: bloqueia cada horário proposto na agenda dos participantes
    // (recrutador + gestor da vaga) com holds tentativos. Best-effort — se o Graph
    // falhar, a enquete segue (não trava o WhatsApp). Os holds são apagados no
    // auto-confirm (sobra só o escolhido) ou pelo cron de limpeza de órfãos.
    const holds = await this.criarHoldsPreReserva(opcoes, candidatura);
    if (holds.length > 0) {
      await this.prisma.enqueteHorario.update({
        where: { id: enquete.id },
        data: { holds: holds as unknown as Prisma.InputJsonValue },
      });
    }

    // Registra também na timeline de mensagens (histórico do candidato).
    await this.prisma.mensagem.create({
      data: {
        candidatura_id: input.candidaturaId,
        candidato_id: candidatura.candidato_id,
        canal: 'WHATSAPP',
        direcao: 'SAIDA',
        template_codigo: 'enquete_horarios',
        corpo: `${pergunta}\n\n${rotulos.map((r, i) => `${i + 1}. ${r}`).join('\n')}`,
        destino: check.chatId,
        provider: 'waha',
        provider_msg_id: enviado.messageId,
        status: 'ENVIADO',
        enviado_em: new Date(),
      },
    });

    this.logger.log(
      `Enquete de horários enviada: enquete=${enquete.id} candidatura=${input.candidaturaId} opcoes=${rotulos.length}`,
    );
    return {
      enqueteId: enquete.id,
      providerMsgId: enviado.messageId,
      opcoes: rotulos.length,
    };
  }

  /**
   * Registra o voto recebido (webhook `poll.vote`). Casa o rótulo escolhido com
   * a opção da enquete e grava início/fim escolhidos.
   */
  async registrarVoto(
    pollMsgId: string,
    selectedOptions: string[],
    votanteChatId?: string,
  ): Promise<{ registrado: boolean }> {
    const escolhido = (selectedOptions ?? [])
      .map((s) => (typeof s === 'string' ? s : (s as { name?: string })?.name))
      .find((s) => typeof s === 'string' && s.trim());
    if (!escolhido) return { registrado: false };

    const enquete = await this.prisma.enqueteHorario.findFirst({
      where: { provider_msg_id: pollMsgId },
      orderBy: { criado_em: 'desc' },
      select: {
        id: true,
        status: true,
        opcoes: true,
        opcao_escolhida: true,
        candidatura_id: true,
        candidato_id: true,
      },
    });
    if (!enquete) {
      this.logger.warn(
        `Voto de enquete sem enquete correspondente (pollMsgId=${pollMsgId}).`,
      );
      return { registrado: false };
    }

    // TRAVA: o primeiro voto é definitivo. Se o candidato trocar a escolha no
    // WhatsApp depois (a enquete nativa permite), ignoramos — vale o 1º voto.
    if (enquete.status === 'RESPONDIDA' && enquete.opcao_escolhida) {
      this.logger.log(
        `Enquete ${enquete.id} já respondida ("${enquete.opcao_escolhida}") — voto posterior ignorado.`,
      );
      return { registrado: false };
    }

    const opcoes = (enquete.opcoes as unknown as OpcaoHorario[]) ?? [];
    const opcao = opcoes.find((o) => o.rotulo.trim() === escolhido.trim());
    if (!opcao) {
      this.logger.warn(
        `Voto "${escolhido}" não casa com nenhuma opção da enquete ${enquete.id}.`,
      );
      return { registrado: false };
    }

    const agora = new Date();
    await this.prisma.enqueteHorario.update({
      where: { id: enquete.id },
      data: {
        status: 'RESPONDIDA',
        opcao_escolhida: opcao.rotulo,
        inicio_escolhido: parseHorarioBrasil(opcao.inicio),
        fim_escolhido: parseHorarioBrasil(opcao.fim),
        respondido_em: agora,
      },
    });

    // Anota na timeline a escolha do candidato.
    await this.prisma.mensagem.create({
      data: {
        candidatura_id: enquete.candidatura_id,
        candidato_id: enquete.candidato_id,
        canal: 'WHATSAPP',
        direcao: 'ENTRADA',
        corpo: `Escolheu o horário: ${opcao.rotulo}`,
        destino: '',
        provider: 'waha',
        status: 'RESPONDIDO',
        respondido_em: agora,
      },
    });

    // Confirma ao candidato (best-effort). O LINK não vai agora — só dentro de 2h
    // antes da reunião (ou na hora, se já estiver nessa janela).
    if (votanteChatId) {
      try {
        await this.waha.sendText({
          chatId: votanteChatId as `${string}@c.us`,
          texto:
            `✅ Recebemos sua escolha: *${opcao.rotulo}*. ` +
            'Sua entrevista está confirmada — o link da call chega aqui mais perto do horário. Até breve!',
        });
      } catch (err) {
        this.logger.warn(
          `Falha ao confirmar voto ao candidato (não crítico): ${(err as Error).message}`,
        );
      }
    }

    // Auto-confirma a entrevista a partir do voto: cria a reunião no Teams + apaga
    // os holds dos outros horários + agenda o envio do link. Assíncrono e idempotente
    // (jobId por enquete) pra não travar o webhook do voto.
    await this.filaConfirmar
      .add(
        'confirmar',
        { enqueteId: enquete.id },
        {
          jobId: `confirmar-${enquete.id}`,
          attempts: 5,
          backoff: { type: 'exponential', delay: 5_000 },
        },
      )
      .catch((err) =>
        this.logger.warn(
          `Falha ao enfileirar auto-confirm da enquete ${enquete.id}: ${(err as Error).message}`,
        ),
      );

    this.logger.log(
      `Voto registrado na enquete ${enquete.id}: "${opcao.rotulo}" → auto-confirm enfileirado.`,
    );
    return { registrado: true };
  }

  async listarPorCandidatura(candidaturaId: string) {
    return this.prisma.enqueteHorario.findMany({
      where: { candidatura_id: candidaturaId },
      orderBy: { criado_em: 'desc' },
      take: 20,
      select: {
        id: true,
        status: true,
        pergunta: true,
        opcoes: true,
        opcao_escolhida: true,
        inicio_escolhido: true,
        fim_escolhido: true,
        respondido_em: true,
        criado_em: true,
        // Quando preenchido, a enquete já virou entrevista — a UI usa isto para
        // esconder o botão "Confirmar no Teams" e mostrar "Confirmada".
        entrevista_id: true,
      },
    });
  }

  /**
   * Cria os holds tentativos da pré-reserva: para CADA horário proposto, um evento
   * tentativo na agenda de CADA participante (recrutador + gestor da vaga). Devolve
   * [{rotulo, participante, eventId}] p/ persistir em `EnqueteHorario.holds` —
   * usado depois pra apagar os holds (no auto-confirm ou no cron). Best-effort.
   */
  private async criarHoldsPreReserva(
    opcoes: OpcaoHorario[],
    candidatura: {
      candidato: { nome_completo: string | null };
      vaga: {
        titulo: string | null;
        recrutador: { email: string | null } | null;
        gestor: { email: string | null } | null;
      } | null;
    },
  ): Promise<Array<{ rotulo: string; participante: string; eventId: string }>> {
    if (!this.graph.enabled) return [];
    const emails = [
      candidatura.vaga?.recrutador?.email,
      candidatura.vaga?.gestor?.email,
    ]
      .filter((e): e is string => !!e && e.includes('@'))
      .map((e) => e.toLowerCase());
    const participantes = [...new Set(emails)];
    if (participantes.length === 0) return [];

    const titulo = candidatura.vaga?.titulo ?? 'Entrevista';
    const nome = candidatura.candidato?.nome_completo ?? 'candidato(a)';
    const assunto = `[PRÉ-RESERVA] Entrevista — ${titulo} (${nome})`;
    const corpoHtml =
      `<p>Horário pré-reservado para a entrevista com ${nome}. Vira reunião ` +
      `definitiva quando o candidato confirmar o horário; caso contrário é liberado.</p>`;

    const holds: Array<{ rotulo: string; participante: string; eventId: string }> = [];
    for (const o of opcoes) {
      const inicio = parseHorarioBrasil(o.inicio);
      const fim = parseHorarioBrasil(o.fim);
      for (const email of participantes) {
        try {
          const eventId = await this.graph.criarEventoTentativo({
            usuarioEmail: email,
            inicio,
            fim,
            assunto,
            corpoHtml,
          });
          holds.push({ rotulo: o.rotulo.trim(), participante: email, eventId });
        } catch (err) {
          this.logger.warn(
            `Pré-reserva: falha ao criar hold (${email}, "${o.rotulo}"): ${(err as Error).message}`,
          );
        }
      }
    }
    this.logger.log(
      `Pré-reserva: ${holds.length} hold(s) criados (participantes=${participantes.length}, slots=${opcoes.length}).`,
    );
    return holds;
  }
}
