import { Injectable, Logger } from '@nestjs/common';
import { TipoNotificacao } from '@uniats/db';

import { PrismaService } from '../../prisma/prisma.service.js';

const SELECT_NOTIFICACAO = {
  id: true,
  tipo: true,
  titulo: true,
  mensagem: true,
  link: true,
  referencia_id: true,
  lida_em: true,
  criado_em: true,
} as const;

interface EmitirInput {
  /** Destinatários. Ids nulos/repetidos são ignorados. */
  usuarioIds: Array<string | null | undefined>;
  tipo: TipoNotificacao;
  titulo: string;
  mensagem: string;
  /** Rota INTERNA do app (ex.: /entrevistas/<id>). */
  link?: string | null;
  /** Entidade que originou o aviso — chave de dedupe junto de (usuario, tipo). */
  referenciaId?: string | null;
}

/**
 * Notificações internas (sino no header). Canal ÚNICO in-app: cria uma linha por
 * destinatário e o front consome por polling. Os `notificar*` são helpers de alto
 * nível chamados dos pontos de gatilho — best-effort: NUNCA lançam, pois são
 * acessórios ao fluxo principal (confirmar entrevista, analisar respostas).
 */
@Injectable()
export class NotificacoesService {
  private readonly logger = new Logger(NotificacoesService.name);
  // Data/hora em pt-BR no fuso do Brasil (o servidor pode rodar em UTC).
  private readonly fmtDataHora = new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  });

  constructor(private readonly prisma: PrismaService) {}

  async listar(
    usuarioId: string,
    opts: { apenasNaoLidas?: boolean; limite?: number } = {},
  ) {
    const limite = Math.min(Math.max(opts.limite ?? 30, 1), 100);
    const [itens, naoLidas] = await Promise.all([
      this.prisma.notificacao.findMany({
        where: {
          usuario_id: usuarioId,
          ...(opts.apenasNaoLidas ? { lida_em: null } : {}),
        },
        orderBy: { criado_em: 'desc' },
        take: limite,
        select: SELECT_NOTIFICACAO,
      }),
      this.contarNaoLidas(usuarioId),
    ]);
    return { itens, naoLidas };
  }

  contarNaoLidas(usuarioId: string): Promise<number> {
    return this.prisma.notificacao.count({
      where: { usuario_id: usuarioId, lida_em: null },
    });
  }

  /** Marca uma notificação como lida. Escopado por usuário (não marca a de outro). Idempotente. */
  async marcarLida(usuarioId: string, id: string): Promise<void> {
    await this.prisma.notificacao.updateMany({
      where: { id, usuario_id: usuarioId, lida_em: null },
      data: { lida_em: new Date() },
    });
  }

  async marcarTodasLidas(usuarioId: string): Promise<number> {
    const r = await this.prisma.notificacao.updateMany({
      where: { usuario_id: usuarioId, lida_em: null },
      data: { lida_em: new Date() },
    });
    return r.count;
  }

  /**
   * Cria uma notificação por destinatário. Dedup via @@unique (usuario, tipo,
   * referencia) — reprocesso de job com retry não duplica o aviso.
   */
  async emitir(input: EmitirInput): Promise<void> {
    const ids = [...new Set(input.usuarioIds.filter((x): x is string => !!x))];
    if (ids.length === 0) return;
    await this.prisma.notificacao.createMany({
      data: ids.map((usuario_id) => ({
        usuario_id,
        tipo: input.tipo,
        titulo: input.titulo,
        mensagem: input.mensagem,
        link: input.link ?? null,
        referencia_id: input.referenciaId ?? null,
      })),
      skipDuplicates: true,
    });
  }

  /** Aviso "candidato confirmou o horário" → recrutador + gestor da vaga. */
  async notificarHorarioConfirmado(entrevistaId: string): Promise<void> {
    try {
      const d = await this.resolverEntrevista(entrevistaId);
      if (!d) return;
      await this.emitir({
        usuarioIds: d.usuarioIds,
        tipo: TipoNotificacao.HORARIO_CONFIRMADO,
        titulo: 'Horário de entrevista confirmado',
        mensagem:
          `${d.nomeCandidato} escolheu um horário e a entrevista de ` +
          `"${d.tituloVaga}" foi confirmada para ${this.fmtDataHora.format(d.agendadaPara)}.`,
        link: `/entrevistas/${entrevistaId}`,
        referenciaId: entrevistaId,
      });
    } catch (err) {
      this.logger.warn(
        `notificarHorarioConfirmado falhou (entrevista ${entrevistaId}): ${(err as Error).message}`,
      );
    }
  }

  /** Aviso "análise das respostas concluída" → recrutador + gestor da vaga. */
  async notificarAnalisePronta(entrevistaId: string): Promise<void> {
    try {
      const d = await this.resolverEntrevista(entrevistaId);
      if (!d) return;
      await this.emitir({
        usuarioIds: d.usuarioIds,
        tipo: TipoNotificacao.ANALISE_PRONTA,
        titulo: 'Análise da entrevista pronta',
        mensagem:
          `A análise das respostas de ${d.nomeCandidato} para "${d.tituloVaga}" ` +
          `já está disponível.`,
        link: `/entrevistas/${entrevistaId}`,
        referenciaId: entrevistaId,
      });
    } catch (err) {
      this.logger.warn(
        `notificarAnalisePronta falhou (entrevista ${entrevistaId}): ${(err as Error).message}`,
      );
    }
  }

  /**
   * Interessados de uma entrevista: entrevistador + recrutador + gestor da vaga
   * (deduplicados/filtrados em `emitir`). Retorna null se a entrevista sumiu.
   */
  private async resolverEntrevista(entrevistaId: string): Promise<{
    usuarioIds: Array<string | null>;
    nomeCandidato: string;
    tituloVaga: string;
    agendadaPara: Date;
  } | null> {
    const e = await this.prisma.entrevista.findUnique({
      where: { id: entrevistaId },
      select: {
        agendada_para: true,
        entrevistador_id: true,
        candidato: { select: { nome_completo: true } },
        candidatura: {
          select: {
            vaga: {
              select: { titulo: true, recrutador_id: true, gestor_id: true },
            },
          },
        },
      },
    });
    if (!e) return null;
    return {
      usuarioIds: [
        e.entrevistador_id,
        e.candidatura?.vaga?.recrutador_id ?? null,
        e.candidatura?.vaga?.gestor_id ?? null,
      ],
      nomeCandidato: e.candidato?.nome_completo ?? 'O candidato',
      tituloVaga: e.candidatura?.vaga?.titulo ?? 'a vaga',
      agendadaPara: e.agendada_para,
    };
  }
}
