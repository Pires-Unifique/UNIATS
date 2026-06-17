import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@uniats/db';

import { PrismaService } from '../../prisma/prisma.service.js';
import { WahaClient } from '../waha/waha.client.js';

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
          select: { telefone: true, excluido_em: true },
        },
        vaga: { select: { titulo: true } },
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
        inicio_escolhido: new Date(opcao.inicio),
        fim_escolhido: new Date(opcao.fim),
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

    // Confirma ao candidato (best-effort) — reforça que a escolha foi travada.
    if (votanteChatId) {
      try {
        await this.waha.sendText({
          chatId: votanteChatId as `${string}@c.us`,
          texto:
            `✅ Recebemos sua escolha: *${opcao.rotulo}*. ` +
            'Em breve confirmamos os detalhes da entrevista. Obrigado!',
        });
      } catch (err) {
        this.logger.warn(
          `Falha ao confirmar voto ao candidato (não crítico): ${(err as Error).message}`,
        );
      }
    }

    this.logger.log(
      `Voto registrado na enquete ${enquete.id}: "${opcao.rotulo}".`,
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
}
