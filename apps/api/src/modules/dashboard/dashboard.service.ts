import { Injectable } from '@nestjs/common';
import { Prisma } from '@uniats/db';
import type {
  DashboardDTO,
  EntrevistaHojeDTO,
  EscopoDashboard,
  FunilEtapaDTO,
  PendenciasDashboardDTO,
  VagaResumoDashboardDTO,
} from '@uniats/shared';

import { PrismaService } from '../../prisma/prisma.service.js';
import {
  AnaliseService,
  APOS_AGENDAMENTO,
  APOS_REALIZACAO,
  APOS_TRIAGEM,
  APROVADOS,
} from '../analise/analise.service.js';
import { AuthService } from '../auth/auth.service.js';
import type { UsuarioAutenticado } from '../auth/auth.types.js';

const DIA_MS = 24 * 60 * 60 * 1000;

// Fuso fixo de Brasília (UTC-3). O Brasil não tem horário de verão desde 2019,
// então o offset é constante — evita depender do TZ do container (prod é UTC).
const OFFSET_BRT_MS = 3 * 60 * 60 * 1000;

/** Meia-noite de HOJE em Brasília, expressa em UTC. */
function inicioDoDiaBrt(agora: Date): Date {
  const brt = new Date(agora.getTime() - OFFSET_BRT_MS);
  return new Date(
    Date.UTC(brt.getUTCFullYear(), brt.getUTCMonth(), brt.getUTCDate()) +
      OFFSET_BRT_MS,
  );
}

/** Chave YYYY-MM-DD do instante no fuso de Brasília. */
function diaBrt(d: Date): string {
  return new Date(d.getTime() - OFFSET_BRT_MS).toISOString().slice(0, 10);
}

/** Escopo resolvido do dashboard (ver `escopoVagas`). */
interface EscopoResolvido {
  whereVaga: Prisma.VagaWhereInput;
  escopo: EscopoDashboard;
  /** Inclui na agenda entrevistas em que o usuário é o entrevistador. */
  incluirEntrevistador: boolean;
}

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  async resumo(usuario: UsuarioAutenticado): Promise<DashboardDTO> {
    const agora = new Date();
    const { whereVaga, escopo, incluirEntrevistador } =
      await this.escopoVagas(usuario);

    // Entrevistas do usuário: pelas vagas do escopo e, para o recrutador,
    // também as em que ele é o entrevistador (vaga pode estar com outro).
    const escopoEntrevista: Prisma.EntrevistaWhereInput = incluirEntrevistador
      ? {
          OR: [
            { candidatura: { vaga: whereVaga } },
            { entrevistador_id: usuario.id },
          ],
        }
      : { candidatura: { vaga: whereVaga } };

    const [
      vagas,
      entrevistasHoje,
      aguardandoCandidato,
      novosCandidatos,
      analisesProntas,
      pendencias,
      vagasTop,
      funil30d,
      taxaNoShow30d,
    ] = await Promise.all([
      this.blocoVagas(whereVaga),
      this.blocoEntrevistasHoje(escopoEntrevista, agora),
      this.blocoEnquetes(whereVaga, agora),
      this.blocoNovosCandidatos(whereVaga, agora),
      this.prisma.notificacao.count({
        where: {
          usuario_id: usuario.id,
          tipo: 'ANALISE_PRONTA',
          lida_em: null,
        },
      }),
      this.blocoPendencias(whereVaga, escopoEntrevista, agora),
      this.blocoVagasTop(whereVaga, agora),
      this.blocoFunil(whereVaga, agora),
      this.blocoTaxaNoShow(escopoEntrevista, agora),
    ]);

    return {
      escopo,
      vagas,
      entrevistasHoje,
      aguardandoCandidato,
      novosCandidatos,
      analisesProntas,
      pendencias: {
        ...pendencias,
        enquetesSemResposta24h: aguardandoCandidato.ha24h,
      },
      vagasTop,
      funil30d,
      taxaNoShow30d,
    };
  }

  /**
   * Escopo de vagas do dashboard:
   *  - gestor (sem admin/recrutamento): vagas em que é o `gestor_id`;
   *  - recrutamento/admin: vagas em que é o RECRUTADOR (FK preenchida ou
   *    espelho `recrutador_email` da Gupy, em qualquer domínio irmão). Sem
   *    NENHUMA vaga própria (ex.: admin que não recruta), cai para a visão
   *    global — o front rotula a diferença via `escopo`.
   */
  private async escopoVagas(
    usuario: UsuarioAutenticado,
  ): Promise<EscopoResolvido> {
    if (!this.auth.podeVerTodasVagas(usuario)) {
      return {
        whereVaga: { gestor_id: usuario.id, excluido_em: null },
        escopo: 'meu',
        incluirEntrevistador: false,
      };
    }
    const minhas: Prisma.VagaWhereInput = {
      excluido_em: null,
      OR: [
        { recrutador_id: usuario.id },
        {
          recrutador_email: {
            in: this.auth.variantesDeEmail(usuario.email),
          },
        },
      ],
    };
    const temVagaPropria = await this.prisma.vaga.count({ where: minhas });
    if (temVagaPropria > 0) {
      return { whereVaga: minhas, escopo: 'meu', incluirEntrevistador: true };
    }
    return {
      whereVaga: { excluido_em: null },
      escopo: 'global',
      incluirEntrevistador: true,
    };
  }

  private async blocoVagas(
    whereVaga: Prisma.VagaWhereInput,
  ): Promise<DashboardDTO['vagas']> {
    const [publicadas, semCandidatura] = await Promise.all([
      this.prisma.vaga.count({
        where: { AND: [whereVaga, { status: 'PUBLICADA' }] },
      }),
      this.prisma.vaga.count({
        where: {
          AND: [
            whereVaga,
            { status: 'PUBLICADA', candidaturas: { none: {} } },
          ],
        },
      }),
    ]);
    return { publicadas, semCandidatura };
  }

  private async blocoEntrevistasHoje(
    escopoEntrevista: Prisma.EntrevistaWhereInput,
    agora: Date,
  ): Promise<EntrevistaHojeDTO[]> {
    const inicio = inicioDoDiaBrt(agora);
    const fim = new Date(inicio.getTime() + DIA_MS);
    const itens = await this.prisma.entrevista.findMany({
      where: {
        AND: [escopoEntrevista, { agendada_para: { gte: inicio, lt: fim } }],
      },
      orderBy: { agendada_para: 'asc' },
      take: 50,
      select: {
        id: true,
        agendada_para: true,
        duracao_estimada_min: true,
        status: true,
        meet_url: true,
        teams_join_url: true,
        candidatura: {
          select: { id: true, vaga: { select: { titulo: true } } },
        },
        candidato: { select: { nome_completo: true } },
        transcricao: { select: { id: true } },
      },
    });
    return itens.map((e) => ({
      id: e.id,
      agendadaPara: e.agendada_para.toISOString(),
      duracaoMin: e.duracao_estimada_min,
      status: e.status,
      candidatoNome: e.candidato?.nome_completo ?? '—',
      vagaTitulo: e.candidatura?.vaga?.titulo ?? null,
      candidaturaId: e.candidatura?.id ?? null,
      meetUrl: e.teams_join_url ?? e.meet_url,
      temAnalise: e.transcricao != null,
    }));
  }

  private async blocoEnquetes(
    whereVaga: Prisma.VagaWhereInput,
    agora: Date,
  ): Promise<DashboardDTO['aguardandoCandidato']> {
    const base: Prisma.EnqueteHorarioWhereInput = {
      status: 'AGUARDANDO',
      candidatura: { vaga: whereVaga },
    };
    const [total, ha24h] = await Promise.all([
      this.prisma.enqueteHorario.count({ where: base }),
      this.prisma.enqueteHorario.count({
        where: {
          AND: [base, { criado_em: { lt: new Date(agora.getTime() - DIA_MS) } }],
        },
      }),
    ]);
    return { total, ha24h };
  }

  private async blocoNovosCandidatos(
    whereVaga: Prisma.VagaWhereInput,
    agora: Date,
  ): Promise<DashboardDTO['novosCandidatos']> {
    const inicioHoje = inicioDoDiaBrt(agora);
    // 14 buckets diários (13 dias atrás … hoje), no fuso de Brasília.
    const inicio14d = new Date(inicioHoje.getTime() - 13 * DIA_MS);
    const rows = await this.prisma.candidatura.findMany({
      where: { vaga: whereVaga, inscrito_em: { gte: inicio14d } },
      select: { inscrito_em: true },
    });

    const buckets = new Map<string, number>();
    for (let i = 0; i < 14; i++) {
      buckets.set(diaBrt(new Date(inicio14d.getTime() + i * DIA_MS)), 0);
    }
    for (const r of rows) {
      if (!r.inscrito_em) continue;
      const dia = diaBrt(r.inscrito_em);
      const atual = buckets.get(dia);
      if (atual !== undefined) buckets.set(dia, atual + 1);
    }
    const porDia = [...buckets].map(([dia, total]) => ({ dia, total }));
    const total7d = porDia.slice(7).reduce((acc, d) => acc + d.total, 0);
    const prev7d = porDia.slice(0, 7).reduce((acc, d) => acc + d.total, 0);
    return {
      total7d,
      variacaoSemana: prev7d > 0 ? (total7d - prev7d) / prev7d : null,
      porDia,
    };
  }

  private async blocoPendencias(
    whereVaga: Prisma.VagaWhereInput,
    escopoEntrevista: Prisma.EntrevistaWhereInput,
    agora: Date,
  ): Promise<PendenciasDashboardDTO> {
    const ha7d = new Date(agora.getTime() - 7 * DIA_MS);
    const ha14d = new Date(agora.getTime() - 14 * DIA_MS);
    const ha60d = new Date(agora.getTime() - 60 * DIA_MS);

    const [semParecer, paradas, noShows7d, vagasSemCandidatura] =
      await Promise.all([
        // Entrevistas realizadas sem parecer final (janela de 60 dias para
        // não arrastar backlog antigo eternamente).
        this.prisma.entrevista.count({
          where: {
            AND: [
              escopoEntrevista,
              {
                status: 'FINALIZADA',
                parecer_final: null,
                finalizada_em: { gte: ha60d },
              },
            ],
          },
        }),
        // Aprovadas na triagem, paradas há +7 dias, sem entrevista marcada.
        this.prisma.candidatura.count({
          where: {
            status: 'APROVADO_TRIAGEM',
            entrevistas: { none: {} },
            vaga: { AND: [whereVaga, { status: 'PUBLICADA' }] },
            OR: [
              { movido_em: { lt: ha7d } },
              { movido_em: null, criado_em: { lt: ha7d } },
            ],
          },
        }),
        this.prisma.entrevista.count({
          where: {
            AND: [
              escopoEntrevista,
              { status: 'NAO_COMPARECEU', agendada_para: { gte: ha7d } },
            ],
          },
        }),
        this.prisma.vaga.count({
          where: {
            AND: [
              whereVaga,
              {
                status: 'PUBLICADA',
                candidaturas: { none: {} },
                OR: [
                  { data_publicacao: { lt: ha14d } },
                  { data_publicacao: null, criado_em: { lt: ha14d } },
                ],
              },
            ],
          },
        }),
      ]);

    return {
      // Preenchido no `resumo()` a partir do bloco de enquetes.
      enquetesSemResposta24h: 0,
      entrevistasSemParecer: semParecer,
      candidaturasParadas: paradas,
      noShows7d,
      vagasSemCandidatura,
    };
  }

  private async blocoVagasTop(
    whereVaga: Prisma.VagaWhereInput,
    agora: Date,
  ): Promise<VagaResumoDashboardDTO[]> {
    const vagas = await this.prisma.vaga.findMany({
      where: { AND: [whereVaga, { status: 'PUBLICADA' }] },
      orderBy: [
        { candidaturas: { _count: 'desc' } },
        { data_publicacao: { sort: 'desc', nulls: 'last' } },
      ],
      take: 5,
      select: {
        id: true,
        titulo: true,
        cidade: true,
        data_publicacao: true,
        criado_em: true,
        _count: { select: { candidaturas: true } },
      },
    });
    if (vagas.length === 0) return [];

    // Maior score IA por vaga (CONSOLIDADO preferido; RANKING_CV cobre as
    // candidaturas que só têm a etapa parcial — mesma regra da listagem).
    const rows = await this.prisma.$queryRaw<
      Array<{ vaga_id: string; top: number | null }>
    >(Prisma.sql`
      SELECT c.vaga_id AS vaga_id, MAX(s.valor)::float8 AS top
      FROM scores s
      JOIN candidaturas c ON c.id = s.candidatura_id
      WHERE s.tipo IN ('CONSOLIDADO', 'RANKING_CV')
        AND c.vaga_id IN (${Prisma.join(
          vagas.map((v) => Prisma.sql`${v.id}::uuid`),
        )})
      GROUP BY c.vaga_id`);
    const topPorVaga = new Map(
      rows
        .filter((r) => r.top != null)
        .map((r) => [r.vaga_id, Math.round(Number(r.top))]),
    );

    return vagas.map((v) => {
      const inicio = v.data_publicacao ?? v.criado_em;
      return {
        id: v.id,
        titulo: v.titulo,
        cidade: v.cidade,
        candidaturas: v._count.candidaturas,
        diasAberta: inicio
          ? Math.max(0, Math.floor((agora.getTime() - inicio.getTime()) / DIA_MS))
          : null,
        topScore: topPorVaga.get(v.id) ?? null,
      };
    });
  }

  /** Mesmo funil cumulativo do painel de Análise, escopado e nos últimos 30d. */
  private async blocoFunil(
    whereVaga: Prisma.VagaWhereInput,
    agora: Date,
  ): Promise<FunilEtapaDTO[]> {
    const base: Prisma.CandidaturaWhereInput = {
      inscrito_em: { gte: new Date(agora.getTime() - 30 * DIA_MS) },
      vaga: whereVaga,
    };
    const contar = (extra: Prisma.CandidaturaWhereInput) =>
      this.prisma.candidatura.count({ where: { AND: [base, extra] } });

    const [
      inscritos,
      triados,
      entrevistaAgendada,
      entrevistaRealizada,
      aprovados,
      contratados,
    ] = await Promise.all([
      this.prisma.candidatura.count({ where: base }),
      contar({ OR: [{ status: { in: APOS_TRIAGEM } }, { scores: { some: {} } }] }),
      contar({
        OR: [
          { status: { in: APOS_AGENDAMENTO } },
          { entrevistas: { some: {} } },
        ],
      }),
      contar({
        OR: [
          { status: { in: APOS_REALIZACAO } },
          { entrevistas: { some: { status: 'FINALIZADA' } } },
        ],
      }),
      contar({ status: { in: APROVADOS } }),
      contar({ status: 'CONTRATADO' }),
    ]);

    return AnaliseService.montarFunil({
      inscritos,
      triados,
      entrevistaAgendada,
      entrevistaRealizada,
      aprovados,
      contratados,
    });
  }

  private async blocoTaxaNoShow(
    escopoEntrevista: Prisma.EntrevistaWhereInput,
    agora: Date,
  ): Promise<number | null> {
    const ha30d = new Date(agora.getTime() - 30 * DIA_MS);
    const [noShow, realizadas] = await Promise.all([
      this.prisma.entrevista.count({
        where: {
          AND: [
            escopoEntrevista,
            { status: 'NAO_COMPARECEU', agendada_para: { gte: ha30d } },
          ],
        },
      }),
      this.prisma.entrevista.count({
        where: {
          AND: [
            escopoEntrevista,
            { status: 'FINALIZADA', agendada_para: { gte: ha30d } },
          ],
        },
      }),
    ]);
    return AnaliseService.taxa(noShow, noShow + realizadas);
  }
}
