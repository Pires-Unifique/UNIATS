import { Injectable } from '@nestjs/common';
import { Prisma, StatusCandidatura } from '@triagem/db';
import type {
  EntrevistasAnaliseDTO,
  FunilEtapaDTO,
  OpcoesFiltroDTO,
  PainelAnaliseDTO,
  PorRecrutadorDTO,
  PorVagaDTO,
  TempoMarcoDTO,
} from '@triagem/shared';

import { PrismaService } from '../../prisma/prisma.service.js';

/** Filtros já validados/parseados (datas como `Date`). */
export interface FiltroInterno {
  de?: Date;
  ate?: Date;
  vagaId?: string;
  recrutadorId?: string;
}

// Status "positivos" do funil em ordem de progresso. REPROVADO/DESISTENTE são
// saídas e não entram na escala ordinal — a posição deles é inferida por
// evidência (tem score → passou triagem; tem entrevista → chegou à entrevista).
const APOS_TRIAGEM: StatusCandidatura[] = [
  'TRIAGEM_IA',
  'APROVADO_TRIAGEM',
  'ENTREVISTA_AGENDADA',
  'ENTREVISTA_REALIZADA',
  'APROVADO',
  'CONTRATADO',
];
const APOS_AGENDAMENTO: StatusCandidatura[] = [
  'ENTREVISTA_AGENDADA',
  'ENTREVISTA_REALIZADA',
  'APROVADO',
  'CONTRATADO',
];
const APOS_REALIZACAO: StatusCandidatura[] = [
  'ENTREVISTA_REALIZADA',
  'APROVADO',
  'CONTRATADO',
];
const APROVADOS: StatusCandidatura[] = ['APROVADO', 'CONTRATADO'];

const OBSERVACOES = [
  'O funil é cumulativo: cada etapa conta quem a alcançou "pelo menos", derivado do status atual + evidências (entrevistas e scores), já que ainda não há log de transições de etapa.',
  'Tempos por etapa são aproximados a partir de inscrição, agendamento e finalização de entrevista e da data de movimentação para CONTRATADO.',
  'Qualidade por fonte de candidatura ainda não está disponível: a fonte não é mapeada da Gupy (só existe no payload bruto).',
];

@Injectable()
export class AnaliseService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------- Helpers puros (testáveis) ----------

  /** Razão segura 0..1; `null` quando o denominador é zero. */
  static taxa(num: number, den: number): number | null {
    if (!den) return null;
    return num / den;
  }

  /** Monta o funil cumulativo a partir das contagens por etapa. */
  static montarFunil(counts: {
    inscritos: number;
    triados: number;
    entrevistaAgendada: number;
    entrevistaRealizada: number;
    aprovados: number;
    contratados: number;
  }): FunilEtapaDTO[] {
    const seq: Array<{ etapa: string; rotulo: string; total: number }> = [
      { etapa: 'INSCRITOS', rotulo: 'Inscritos', total: counts.inscritos },
      { etapa: 'TRIADOS', rotulo: 'Triados', total: counts.triados },
      {
        etapa: 'ENTREVISTA_AGENDADA',
        rotulo: 'Entrevista agendada',
        total: counts.entrevistaAgendada,
      },
      {
        etapa: 'ENTREVISTA_REALIZADA',
        rotulo: 'Entrevista realizada',
        total: counts.entrevistaRealizada,
      },
      { etapa: 'APROVADOS', rotulo: 'Aprovados', total: counts.aprovados },
      { etapa: 'CONTRATADOS', rotulo: 'Contratados', total: counts.contratados },
    ];
    return seq.map((s, i) => ({
      ...s,
      taxaConversao: i === 0 ? null : AnaliseService.taxa(s.total, seq[i - 1].total),
    }));
  }

  // ---------- WHERE compartilhados ----------

  private whereCandidatura(f: FiltroInterno): Prisma.CandidaturaWhereInput {
    const where: Prisma.CandidaturaWhereInput = {};
    if (f.de || f.ate) {
      where.inscrito_em = {};
      if (f.de) where.inscrito_em.gte = f.de;
      if (f.ate) where.inscrito_em.lte = f.ate;
    }
    if (f.vagaId) where.vaga_id = f.vagaId;
    if (f.recrutadorId) where.vaga = { recrutador_id: f.recrutadorId };
    return where;
  }

  /** Fragmento SQL `WHERE` para queries cruas (alias c=candidaturas, v=vagas). */
  private sqlFiltro(f: FiltroInterno): Prisma.Sql {
    const conds: Prisma.Sql[] = [Prisma.sql`TRUE`];
    if (f.de) conds.push(Prisma.sql`c.inscrito_em >= ${f.de}`);
    if (f.ate) conds.push(Prisma.sql`c.inscrito_em <= ${f.ate}`);
    if (f.vagaId) conds.push(Prisma.sql`c.vaga_id = ${f.vagaId}::uuid`);
    if (f.recrutadorId)
      conds.push(Prisma.sql`v.recrutador_id = ${f.recrutadorId}::uuid`);
    return Prisma.join(conds, ' AND ');
  }

  // ---------- Blocos do painel ----------

  private async funil(f: FiltroInterno): Promise<FunilEtapaDTO[]> {
    const base = this.whereCandidatura(f);
    const e = (extra: Prisma.CandidaturaWhereInput) =>
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
      e({ OR: [{ status: { in: APOS_TRIAGEM } }, { scores: { some: {} } }] }),
      e({
        OR: [
          { status: { in: APOS_AGENDAMENTO } },
          { entrevistas: { some: {} } },
        ],
      }),
      e({
        OR: [
          { status: { in: APOS_REALIZACAO } },
          { entrevistas: { some: { status: 'FINALIZADA' } } },
        ],
      }),
      e({ status: { in: APROVADOS } }),
      e({ status: 'CONTRATADO' }),
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

  private async tempos(f: FiltroInterno): Promise<TempoMarcoDTO[]> {
    const filtro = this.sqlFiltro(f);

    const contratacao = this.prisma.$queryRaw<
      Array<{ dias: number | null; n: number }>
    >(Prisma.sql`
      SELECT AVG(EXTRACT(EPOCH FROM (c.movido_em - c.inscrito_em)) / 86400)::float8 AS dias,
             COUNT(*)::int AS n
      FROM candidaturas c
      JOIN vagas v ON v.id = c.vaga_id
      WHERE ${filtro}
        AND c.status = 'CONTRATADO'
        AND c.inscrito_em IS NOT NULL
        AND c.movido_em IS NOT NULL`);

    const ateEntrevista = this.prisma.$queryRaw<
      Array<{ dias: number | null; n: number }>
    >(Prisma.sql`
      SELECT AVG(EXTRACT(EPOCH FROM (fe.primeira - c.inscrito_em)) / 86400)::float8 AS dias,
             COUNT(*)::int AS n
      FROM candidaturas c
      JOIN vagas v ON v.id = c.vaga_id
      JOIN (
        SELECT candidatura_id, MIN(agendada_para) AS primeira
        FROM entrevistas GROUP BY candidatura_id
      ) fe ON fe.candidatura_id = c.id
      WHERE ${filtro}
        AND c.inscrito_em IS NOT NULL
        AND fe.primeira >= c.inscrito_em`);

    const realizacao = this.prisma.$queryRaw<
      Array<{ dias: number | null; n: number }>
    >(Prisma.sql`
      SELECT AVG(EXTRACT(EPOCH FROM (e.finalizada_em - e.agendada_para)) / 86400)::float8 AS dias,
             COUNT(*)::int AS n
      FROM entrevistas e
      JOIN candidaturas c ON c.id = e.candidatura_id
      JOIN vagas v ON v.id = c.vaga_id
      WHERE ${filtro}
        AND e.status = 'FINALIZADA'
        AND e.finalizada_em IS NOT NULL`);

    const [c, ae, r] = await Promise.all([contratacao, ateEntrevista, realizacao]);
    const linha = (
      marco: string,
      rotulo: string,
      rows: Array<{ dias: number | null; n: number }>,
    ): TempoMarcoDTO => {
      const row = rows[0];
      const amostra = Number(row?.n ?? 0);
      const dias = row?.dias == null ? null : Number(row.dias);
      return {
        marco,
        rotulo,
        amostra,
        mediaDias: dias == null ? null : Math.round(dias * 10) / 10,
      };
    };

    return [
      linha('INSCRICAO_ENTREVISTA', 'Inscrição → 1ª entrevista', ae),
      linha('AGENDAMENTO_REALIZACAO', 'Agendamento → realização', r),
      linha('INSCRICAO_CONTRATACAO', 'Inscrição → contratação (time-to-hire)', c),
    ];
  }

  private async entrevistas(f: FiltroInterno): Promise<EntrevistasAnaliseDTO> {
    const where: Prisma.EntrevistaWhereInput = {
      candidatura: this.whereCandidatura(f),
    };
    const [grupos, agendadasFuturas] = await Promise.all([
      this.prisma.entrevista.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
      }),
      this.prisma.entrevista.count({
        where: { AND: [where, { status: 'AGENDADA', agendada_para: { gt: new Date() } }] },
      }),
    ]);

    const porStatus = grupos.map((g) => ({
      status: g.status,
      total: g._count._all,
    }));
    const total = (s: string) =>
      porStatus.find((p) => p.status === s)?.total ?? 0;
    const realizadas = total('FINALIZADA');
    const naoCompareceu = total('NAO_COMPARECEU');

    return {
      porStatus,
      realizadas,
      naoCompareceu,
      agendadasFuturas,
      taxaNoShow: AnaliseService.taxa(naoCompareceu, naoCompareceu + realizadas),
    };
  }

  private async porRecrutador(f: FiltroInterno): Promise<PorRecrutadorDTO[]> {
    const filtro = this.sqlFiltro(f);
    const rows = await this.prisma.$queryRaw<
      Array<{
        recrutador_id: string | null;
        nome: string | null;
        candidaturas: number;
        contratados: number;
      }>
    >(Prisma.sql`
      SELECT v.recrutador_id AS recrutador_id,
             u.nome AS nome,
             COUNT(c.id)::int AS candidaturas,
             COUNT(c.id) FILTER (WHERE c.status = 'CONTRATADO')::int AS contratados
      FROM candidaturas c
      JOIN vagas v ON v.id = c.vaga_id
      LEFT JOIN usuarios u ON u.id = v.recrutador_id
      WHERE ${filtro}
      GROUP BY v.recrutador_id, u.nome
      ORDER BY candidaturas DESC
      LIMIT 20`);

    return rows.map((r) => {
      const candidaturas = Number(r.candidaturas);
      const contratados = Number(r.contratados);
      return {
        recrutadorId: r.recrutador_id,
        nome: r.nome ?? 'Sem recrutador',
        candidaturas,
        contratados,
        taxaConversao: AnaliseService.taxa(contratados, candidaturas) ?? 0,
      };
    });
  }

  private async porVaga(f: FiltroInterno): Promise<PorVagaDTO[]> {
    const filtro = this.sqlFiltro(f);
    const rows = await this.prisma.$queryRaw<
      Array<{
        vaga_id: string;
        titulo: string;
        candidaturas: number;
        contratados: number;
        score_medio: number | null;
      }>
    >(Prisma.sql`
      SELECT v.id AS vaga_id,
             v.titulo AS titulo,
             COUNT(c.id)::int AS candidaturas,
             COUNT(c.id) FILTER (WHERE c.status = 'CONTRATADO')::int AS contratados,
             AVG(sc.valor)::float8 AS score_medio
      FROM candidaturas c
      JOIN vagas v ON v.id = c.vaga_id
      LEFT JOIN LATERAL (
        SELECT s.valor
        FROM scores s
        WHERE s.candidatura_id = c.id AND s.tipo = 'CONSOLIDADO'
        ORDER BY s.criado_em DESC
        LIMIT 1
      ) sc ON TRUE
      WHERE ${filtro}
      GROUP BY v.id, v.titulo
      ORDER BY candidaturas DESC
      LIMIT 15`);

    return rows.map((r) => ({
      vagaId: r.vaga_id,
      titulo: r.titulo,
      candidaturas: Number(r.candidaturas),
      contratados: Number(r.contratados),
      scoreMedio:
        r.score_medio == null ? null : Math.round(Number(r.score_medio) * 10) / 10,
    }));
  }

  // ---------- Orquestração ----------

  async painel(f: FiltroInterno): Promise<PainelAnaliseDTO> {
    const [funil, tempos, entrevistas, porRecrutador, porVaga, vagasDistintas] =
      await Promise.all([
        this.funil(f),
        this.tempos(f),
        this.entrevistas(f),
        this.porRecrutador(f),
        this.porVaga(f),
        this.prisma.candidatura.groupBy({
          by: ['vaga_id'],
          where: this.whereCandidatura(f),
        }),
      ]);

    const inscritos = funil[0]?.total ?? 0;
    const contratados = funil[funil.length - 1]?.total ?? 0;
    const totalEntrevistas = entrevistas.porStatus.reduce(
      (acc, s) => acc + s.total,
      0,
    );
    const tempoContratacao = tempos.find(
      (t) => t.marco === 'INSCRICAO_CONTRATACAO',
    );

    return {
      periodo: {
        de: f.de ? f.de.toISOString() : null,
        ate: f.ate ? f.ate.toISOString() : null,
      },
      resumo: {
        totalCandidaturas: inscritos,
        totalVagasComCandidatura: vagasDistintas.length,
        totalEntrevistas,
        contratados,
        taxaConversaoGeral: AnaliseService.taxa(contratados, inscritos) ?? 0,
        tempoMedioContratacaoDias: tempoContratacao?.mediaDias ?? null,
        taxaNoShow: entrevistas.taxaNoShow,
      },
      funil,
      tempos,
      entrevistas,
      porRecrutador,
      porVaga,
      observacoes: OBSERVACOES,
    };
  }

  async filtros(): Promise<OpcoesFiltroDTO> {
    const [recrutadores, vagas] = await Promise.all([
      this.prisma.usuario.findMany({
        where: { papel: { in: ['RECRUTADOR', 'ADMIN', 'GESTOR'] }, ativo: true },
        select: { id: true, nome: true },
        orderBy: { nome: 'asc' },
      }),
      this.prisma.vaga.findMany({
        where: { excluido_em: null },
        select: { id: true, titulo: true },
        orderBy: [{ data_publicacao: { sort: 'desc', nulls: 'last' } }],
        take: 300,
      }),
    ]);
    return { recrutadores, vagas };
  }
}
