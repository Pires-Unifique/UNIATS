import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Prisma } from '@collab/db';

import { PrismaService } from '../../prisma/prisma.service.js';
import { AuthGuard } from '../auth/auth.guard.js';
import type { UsuarioAutenticado } from '../auth/auth.types.js';
import { UsuarioAtual } from '../auth/usuario-atual.decorator.js';
import { traduzirTipoContrato } from '../gupy/mappers/gupy.mapper.js';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Sentinela do filtro `etapa` para "candidaturas sem etapa no funil da Gupy".
 * `etapa=` vazio significa "todas", então NULL precisa de um valor próprio.
 */
const SEM_ETAPA = '__sem_etapa__';

/** Tipo de vaga (Gupy `type`) que representa o BANCO DE TALENTOS. */
const TIPO_BANCO_TALENTOS = 'talent_pool';

/**
 * Piso de similaridade para alguém do banco de talentos aparecer como indicado.
 *
 * A regra de negócio é "quem se inscreveu NA VAGA tem preferência; do banco só
 * sobe quem for excepcional" — então isto é um piso ALTO de propósito, e a aba
 * vir vazia é o comportamento esperado na maioria das vagas.
 *
 * Calibragem: a escala exibida é ((1 + cosseno) / 2) × 100. Com os embeddings
 * da Voyage neste projeto o cosseno observado gira em torno de 0,47 ± 0,06, o
 * que dá ~73 ± 3 na escala. 80 fica a ~2 desvios acima da média — raro, que é
 * a intenção. Ajustável por env para apertar/afrouxar depois de ver a
 * distribuição real numa vaga de verdade.
 */
const SIMILARIDADE_MINIMA_PADRAO = 80;

// Valores aceitos no filtro de status da listagem (enum StatusVaga do Prisma).
// Valor fora da lista viraria erro 500 do Prisma — barramos com 400 antes.
const STATUS_VAGA_VALIDOS = new Set([
  'RASCUNHO',
  'EM_APROVACAO',
  'APROVADA',
  'PUBLICADA',
  'PAUSADA',
  'ENCERRADA',
  'CANCELADA',
]);

/**
 * Escopo de leitura por ÁREA: quem tem 'admin' ou 'recrutamento' enxerga TODAS
 * as vagas; os demais (ex.: gestor) só as vagas em que são o gestor (gestor_id).
 * Retorna o fragmento `where` a mesclar (ou null = sem restrição).
 */
function escopoPorArea(
  usuario: UsuarioAutenticado,
): { gestor_id: string } | null {
  if (usuario.areas.includes('admin') || usuario.areas.includes('recrutamento')) {
    return null;
  }
  return { gestor_id: usuario.id };
}

/**
 * Monta { nome, email } a partir do que a Gupy mandou no payload. Usado como
 * fallback quando a vaga não tem recrutador/gestor INTERNO (usuário SSO) ligado
 * — caso comum em vagas só sincronizadas, não criadas pelo nosso app.
 */
function pessoaDoPayload(
  nome: unknown,
  email: unknown,
): { nome: string; email: string } | null {
  const n = typeof nome === 'string' ? nome.trim() : '';
  const e = typeof email === 'string' ? email.trim() : '';
  if (!n && !e) return null;
  return { nome: n || e, email: e };
}

/** Lê uma string não-vazia do payload da Gupy (senão null). */
function strDoPayload(valor: unknown): string | null {
  return typeof valor === 'string' && valor.trim() ? valor.trim() : null;
}

/**
 * URL pública da vaga no portal de carreiras (a página que o CANDIDATO vê).
 * A Gupy não devolve essa URL na API — montamos {base}/jobs/{gupy_id}. Cada
 * career page tem subdomínio próprio (vaga de uma NÃO abre na outra), por isso
 * o mapa careerPageId=url para os tenants com mais de uma página.
 */
function urlPublicaGupy(
  gupyId: bigint,
  payload: Record<string, unknown>,
  base: string,
  mapa: string,
): string {
  const careerPageId = payload.careerPageId;
  if (careerPageId != null && mapa) {
    for (const par of mapa.split(',')) {
      const [id, url] = par.split('=');
      if (id?.trim() === String(careerPageId) && url?.trim()) {
        return `${url.trim().replace(/\/+$/, '')}/jobs/${gupyId}`;
      }
    }
  }
  return `${base.replace(/\/+$/, '')}/jobs/${gupyId}`;
}

/**
 * Read API local — frontend usa para listar vagas JÁ SINCRONIZADAS, com
 * contagens de candidaturas. Diferente de `/api/gupy/vagas` (passthrough
 * direto da Gupy), aqui retornamos só o que está no nosso banco.
 */
@Controller('api/vagas')
@UseGuards(ThrottlerGuard, AuthGuard)
export class VagasController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  async listar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Query('status') status?: string,
    @Query('q') q?: string,
    @Query('limite') limiteStr?: string,
    @Query('pendencia') pendencia?: string,
  ) {
    let limite = 50;
    if (limiteStr) {
      const n = Number(limiteStr);
      if (!Number.isInteger(n) || n < 1 || n > 200) {
        throw new BadRequestException('limite deve estar entre 1 e 200.');
      }
      limite = n;
    }
    const where: Record<string, unknown> = { excluido_em: null };
    // PADRÃO: só PUBLICADAS. Outros status (ou todos) são escolha EXPLÍCITA do
    // usuário via filtro — 'TODOS' desliga o filtro de status. Aceita mais de
    // um status separado por vírgula (ex.: PUBLICADA,APROVADA,EM_APROVACAO).
    if (status !== 'TODOS') {
      const lista = (status || 'PUBLICADA')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (lista.length === 0) {
        throw new BadRequestException('status inválido: vazio');
      }
      for (const s of lista) {
        if (!STATUS_VAGA_VALIDOS.has(s)) {
          throw new BadRequestException(`status inválido: ${s}`);
        }
      }
      where.status = lista.length === 1 ? lista[0] : { in: lista };
    }
    // Busca livre casa título OU código interno da vaga (jobCode da Gupy).
    if (q) {
      where.OR = [
        { titulo: { contains: q, mode: 'insensitive' } },
        { codigo: { contains: q, mode: 'insensitive' } },
      ];
    }
    // Filtro de PENDÊNCIA — mesmas definições do card "Precisa de você" do
    // painel inicial (dashboard.service), para o "Ver →" abrir a lista já
    // filtrada. Pendência só faz sentido em vaga NO AR: sobrepõe o status.
    if (pendencia) {
      const agora = Date.now();
      const ha24h = new Date(agora - 24 * 60 * 60 * 1000);
      const ha7d = new Date(agora - 7 * 24 * 60 * 60 * 1000);
      const ha14d = new Date(agora - 14 * 24 * 60 * 60 * 1000);
      where.status = 'PUBLICADA';
      if (pendencia === 'enquete_sem_resposta') {
        // Tem enquete de horários aguardando voto do candidato há +24h.
        where.candidaturas = {
          some: {
            enquetes_horario: {
              some: { status: 'AGUARDANDO', criado_em: { lt: ha24h } },
            },
          },
        };
      } else if (pendencia === 'sem_candidatura') {
        // Publicada há +14 dias e nenhuma candidatura.
        where.candidaturas = { none: {} };
        where.AND = [
          {
            OR: [
              { data_publicacao: { lt: ha14d } },
              { data_publicacao: null, criado_em: { lt: ha14d } },
            ],
          },
        ];
      } else if (pendencia === 'candidaturas_paradas') {
        // Tem candidato aprovado na triagem parado há +7 dias sem entrevista.
        where.candidaturas = {
          some: {
            status: 'APROVADO_TRIAGEM',
            entrevistas: { none: {} },
            OR: [
              { movido_em: { lt: ha7d } },
              { movido_em: null, criado_em: { lt: ha7d } },
            ],
          },
        };
      } else {
        throw new BadRequestException(`pendencia inválida: ${pendencia}`);
      }
    }
    // Gestor/visualizador: restringe às vagas dele.
    const escopo = escopoPorArea(usuario);
    if (escopo) where.gestor_id = escopo.gestor_id;

    const [vagas, totais] = await Promise.all([
      this.prisma.vaga.findMany({
        where,
        // Vagas com mais candidaturas primeiro; depois por publicação (NULLS por último).
        orderBy: [
          { candidaturas: { _count: 'desc' } },
          { data_publicacao: { sort: 'desc', nulls: 'last' } },
          { criado_em: 'desc' },
        ],
        take: limite,
        select: {
          id: true,
          gupy_id: true,
          codigo: true,
          titulo: true,
          departamento: true,
          unidade: true,
          cidade: true,
          estado: true,
          remoto: true,
          status: true,
          data_publicacao: true,
          atualizado_em: true,
          gestor_email: true,
          recrutador_email: true,
          // Nome de gestor/recrutador só existe no payload (managerName/
          // recruiterName) — não há coluna própria nem FK preenchida no sync.
          gupy_payload: true,
          _count: { select: { candidaturas: true } },
        },
      }),
      this.prisma.candidatura.groupBy({
        by: ['vaga_id'],
        _count: { _all: true },
      }),
    ]);

    // BigInt → string para serialização JSON
    const itens = vagas.map((v) => {
      const payload = (v.gupy_payload ?? {}) as Record<string, unknown>;
      const { gupy_payload: _payload, _count, ...resto } = v;
      return {
        ...resto,
        gupy_id: v.gupy_id.toString(),
        qtdCandidaturas: _count.candidaturas,
        // Mesma regra do detalhe: payload primeiro; e-mail espelhado como fallback
        // (vagas antigas sincronizadas antes do managerName/recruiterName).
        recrutador:
          pessoaDoPayload(payload.recruiterName, payload.recruiterEmail) ??
          pessoaDoPayload(null, v.recrutador_email),
        gestor:
          pessoaDoPayload(payload.managerName, payload.managerEmail) ??
          pessoaDoPayload(null, v.gestor_email),
        // Fallback do local no payload — igual ao obter() (vagas antigas foram
        // sincronizadas antes de mapearmos addressCity/addressState).
        cidade: v.cidade ?? strDoPayload(payload.addressCity),
        estado:
          v.estado ??
          strDoPayload(payload.addressStateShortName) ??
          strDoPayload(payload.addressState),
      };
    });

    void totais; // unused — agregação já está em `_count`
    return { total: itens.length, itens };
  }

  @Get(':id')
  async obter(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('id') id: string,
  ) {
    if (!UUID_REGEX.test(id)) {
      throw new BadRequestException('id inválido.');
    }
    // Mescla o escopo no where: vaga de outro gestor → findFirst retorna null →
    // 404 (mesma resposta de "não existe", para não vazar a existência da vaga).
    const escopo = escopoPorArea(usuario);
    const v = await this.prisma.vaga.findFirst({
      where: { id, ...(escopo ?? {}) },
      include: {
        _count: { select: { candidaturas: true } },
      },
    });
    if (!v) throw new NotFoundException(`Vaga ${id} não existe.`);
    // Recrutador/gestor vêm do próprio payload da Gupy (recruiterName/managerName).
    // Ainda não há vagas criadas pelo sistema, então não usamos a relação interna.
    const payload = (v.gupy_payload ?? {}) as Record<string, unknown>;
    // O payload cru NÃO vai na resposta (a listagem já fazia isso): o que a tela
    // precisa dele — nome/e-mail de gestor e recrutador, cidade/estado, link
    // público — é extraído abaixo em campos próprios.
    const { gupy_payload: _payload, ...vagaSemPayload } = v;
    return {
      ...vagaSemPayload,
      tipo_contrato: traduzirTipoContrato(v.tipo_contrato),
      recrutador: pessoaDoPayload(payload.recruiterName, payload.recruiterEmail),
      gestor: pessoaDoPayload(payload.managerName, payload.managerEmail),
      // Local: usa o que está na coluna; senão cai no payload (vagas antigas
      // foram sincronizadas antes de mapearmos addressCity/addressState).
      cidade: v.cidade ?? strDoPayload(payload.addressCity),
      estado:
        v.estado ??
        strDoPayload(payload.addressStateShortName) ??
        strDoPayload(payload.addressState),
      gupy_id: v.gupy_id.toString(),
      qtdCandidaturas: v._count.candidaturas,
      // Link público da vaga no portal de carreiras — o que o candidato vê.
      url_gupy: urlPublicaGupy(
        v.gupy_id,
        payload,
        this.config.get<string>(
          'GUPY_CAREERS_BASE_URL',
          'https://vemserunifique.gupy.io',
        ),
        this.config.get<string>('GUPY_CAREERS_URL_MAP', ''),
      ),
    };
  }

  /**
   * Lista as candidaturas (candidatos) de uma vaga — leitura direta do banco,
   * SEM depender de score/ranking. Usado para exibir os candidatos na vaga
   * antes da classificação por IA.
   */
  @Get(':id/candidaturas')
  async candidaturas(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('id') id: string,
    @Query('limite') limiteStr?: string,
    @Query('offset') offsetStr?: string,
    @Query('q') q?: string,
    @Query('incluirReprovados') incluirReprovados?: string,
    @Query('etapa') etapa?: string,
  ) {
    if (!UUID_REGEX.test(id)) {
      throw new BadRequestException('id inválido.');
    }
    let limite = 200;
    if (limiteStr) {
      const n = Number(limiteStr);
      if (!Number.isInteger(n) || n < 1 || n > 500) {
        throw new BadRequestException('limite deve estar entre 1 e 500.');
      }
      limite = n;
    }
    let offset = 0;
    if (offsetStr) {
      const n = Number(offsetStr);
      if (!Number.isInteger(n) || n < 0 || n > 1_000_000) {
        throw new BadRequestException('offset inválido.');
      }
      offset = n;
    }

    // Mesmo escopo da leitura da vaga: gestor não acessa candidatos de vaga alheia.
    const escopo = escopoPorArea(usuario);
    const vaga = await this.prisma.vaga.findFirst({
      where: { id, ...(escopo ?? {}) },
      select: { id: true, titulo: true, gupy_id: true },
    });
    if (!vaga) throw new NotFoundException(`Vaga ${id} não existe.`);

    const busca = q?.trim();
    const where: Record<string, unknown> = { vaga_id: id };
    // Por padrão, esconde candidatos REPROVADOS/DESISTENTES da listagem.
    if (incluirReprovados !== 'true') {
      where.status = { notIn: ['REPROVADO', 'DESISTENTE'] };
    }
    if (busca) {
      const contem = { contains: busca, mode: 'insensitive' as const };
      where.candidato = {
        OR: [
          { nome_completo: contem },
          { email: contem },
          { cidade: contem },
        ],
      };
    }

    // Filtro por ETAPA do funil da Gupy (aba "Triagem", "Entrevista", …).
    // O DHO trabalha por etapa (é assim que a Gupy mostra), então a listagem
    // filtra no BANCO — client-side quebraria em vaga grande, onde a página de
    // 200 não contém todas as etapas. `SEM_ETAPA` cobre candidaturas ainda sem
    // `etapa_gupy` (sincronizadas antes de entrar no funil).
    const etapaFiltro = etapa?.trim();
    if (etapaFiltro) {
      if (etapaFiltro.length > 120) {
        throw new BadRequestException('etapa inválida.');
      }
      where.etapa_gupy = etapaFiltro === SEM_ETAPA ? null : etapaFiltro;
    }
    const condEtapa = !etapaFiltro
      ? Prisma.empty
      : etapaFiltro === SEM_ETAPA
        ? Prisma.sql`AND c.etapa_gupy IS NULL`
        : Prisma.sql`AND c.etapa_gupy = ${etapaFiltro}`;

    // Página de IDs ordenada NO BANCO: quem tem nota vem primeiro (maior nota
    // no topo), depois os sem nota por inscrição mais recente. Sem isso, vaga
    // com mais candidatos que o `limite` escondia justamente os avaliados — a
    // janela antiga cortava pelos mais recentes ANTES de ordenar por nota, e o
    // top-N escolhido por similaridade raramente está entre os mais recentes.
    // `total` é a contagem real (a UI pagina com offset/"Carregar mais").
    const condReprovados =
      incluirReprovados !== 'true'
        ? Prisma.sql`AND c.status NOT IN ('REPROVADO', 'DESISTENTE')`
        : Prisma.empty;
    const condBusca = busca
      ? Prisma.sql`AND (ca.nome_completo ILIKE ${'%' + busca + '%'} OR ca.email ILIKE ${'%' + busca + '%'} OR ca.cidade ILIKE ${'%' + busca + '%'})`
      : Prisma.empty;
    const [total, pagina, resumoRows] = await Promise.all([
      this.prisma.candidatura.count({
        where: where as Prisma.CandidaturaWhereInput,
      }),
      this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT c.id
        FROM candidaturas c
        JOIN candidatos ca ON ca.id = c.candidato_id
        LEFT JOIN LATERAL (
          SELECT s.valor FROM scores s
          WHERE s.candidatura_id = c.id AND s.tipo = 'CONSOLIDADO'
          ORDER BY s.criado_em DESC LIMIT 1
        ) sc ON TRUE
        LEFT JOIN LATERAL (
          SELECT s.valor FROM scores s
          WHERE s.candidatura_id = c.id AND s.tipo = 'RANKING_CV'
          ORDER BY s.criado_em DESC LIMIT 1
        ) sr ON TRUE
        WHERE c.vaga_id = ${id}::uuid
          ${condReprovados}
          ${condBusca}
          ${condEtapa}
        ORDER BY COALESCE(sc.valor, sr.valor) DESC NULLS LAST,
                 c.inscrito_em DESC NULLS LAST,
                 c.criado_em DESC
        LIMIT ${limite} OFFSET ${offset}
      `),
      // Contagem por etapa do funil. Deliberadamente SEM o filtro de etapa
      // (senão a sub-aba selecionada zeraria as outras) e SEM reprovados/
      // desistentes (as sub-abas de etapa vivem dentro de "Candidatos", que é
      // o conjunto ativo). É o total real da vaga, não o da página.
      this.prisma.$queryRaw<Array<{ etapa: string | null; total: bigint }>>(Prisma.sql`
        SELECT c.etapa_gupy AS etapa, count(*) AS total
        FROM candidaturas c
        JOIN candidatos ca ON ca.id = c.candidato_id
        WHERE c.vaga_id = ${id}::uuid
          AND c.status NOT IN ('REPROVADO', 'DESISTENTE')
          ${condBusca}
        GROUP BY c.etapa_gupy
        ORDER BY count(*) DESC
      `),
    ]);
    const ids = pagina.map((r) => r.id);

    const cands = await this.prisma.candidatura.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        status: true,
        etapa_gupy: true,
        origem: true,
        motivo_desclassif: true,
        inscrito_em: true,
        candidato: {
          select: {
            nome_completo: true,
            email: true,
            telefone: true,
            cidade: true,
            estado: true,
          },
        },
        curriculo: { select: { anos_experiencia: true } },
        scores: {
          where: { tipo: { in: ['CONSOLIDADO', 'RANKING_CV'] } },
          select: { tipo: true, valor: true, justificativa: true },
          orderBy: { criado_em: 'desc' },
        },
      },
    });
    // findMany não preserva a ordem do IN — reordena pela página do SQL.
    const porId = new Map(cands.map((c) => [c.id, c]));
    const ordenados = ids
      .map((i) => porId.get(i))
      .filter((c): c is NonNullable<typeof c> => Boolean(c));

    const itens = ordenados.map((c) => {
      const consolidado = c.scores.find((s) => s.tipo === 'CONSOLIDADO');
      const rankingCv = c.scores.find((s) => s.tipo === 'RANKING_CV');
      // Nota IA exibida = melhor disponível: CONSOLIDADO (preferido) e, na sua
      // ausência, RANKING_CV. Candidaturas que têm só o RANKING_CV (estado
      // parcial conhecido na base) tinham nota mas apareciam como "sem nota" —
      // o que escondia a avaliação dos demais usuários. O fallback corrige isso
      // sem mudar a regra de "pendente" (que continua olhando o CONSOLIDADO).
      const notaIA = consolidado ?? rankingCv;
      return {
        candidaturaId: c.id,
        candidatoNome: c.candidato.nome_completo,
        email: c.candidato.email,
        telefone: c.candidato.telefone,
        cidade: c.candidato.cidade,
        estado: c.candidato.estado,
        status: c.status,
        etapaGupy: c.etapa_gupy,
        // 'BANCO_TALENTOS' = pessoa puxada pelo recrutador, NÃO se inscreveu
        // nesta vaga. A tela marca com selo para não confundir com candidato.
        origem: c.origem,
        motivoDesclassif: c.motivo_desclassif,
        inscritoEm: c.inscrito_em,
        anosExperiencia: c.curriculo?.anos_experiencia ?? null,
        temCurriculo: c.curriculo != null,
        score: notaIA ? Number(notaIA.valor) : null,
        justificativa: (rankingCv ?? consolidado)?.justificativa ?? null,
      };
    });

    // Ordenação (nota desc, depois inscrição) já veio do SQL da página.
    return {
      vaga: { id: vaga.id, titulo: vaga.titulo, gupyId: vaga.gupy_id.toString() },
      total,
      itens,
      resumoEtapas: resumoRows.map((r) => ({
        etapa: r.etapa,
        total: Number(r.total),
      })),
    };
  }

  /**
   * TALENTOS SUGERIDOS — candidatos do BANCO DE TALENTOS (vagas Gupy do tipo
   * `talent_pool`) mais próximos desta vaga por similaridade vetorial.
   *
   * É busca vetorial PURA (pgvector + índice HNSW): não chama Voyage nem Claude,
   * portanto não consome token nem crédito. Reusa os embeddings já gravados pelo
   * fluxo de ranking — se a vaga ainda não tem vetor, devolve lista vazia com
   * `vagaSemVetor: true` para a UI orientar a rodar a classificação antes.
   *
   * LGPD: a base é APENAS quem se inscreveu no banco de talentos — ou seja, quem
   * deu opt-in explícito para ser considerado em outras vagas. Candidatos de
   * vagas comuns NÃO entram aqui: o currículo deles foi enviado para uma
   * finalidade específica e reaproveitá-lo seria desvio de finalidade.
   */
  @Get(':id/talentos-sugeridos')
  async talentosSugeridos(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('id') id: string,
    @Query('limite') limiteStr?: string,
    @Query('minSimilaridade') minStr?: string,
  ) {
    if (!UUID_REGEX.test(id)) {
      throw new BadRequestException('id inválido.');
    }
    // A sugestão traz gente de FORA desta vaga. O gestor só enxerga a própria
    // vaga (escopoPorArea), então liberar aqui furaria esse escopo — a triagem
    // do banco de talentos é do recrutador/DHO.
    if (
      !usuario.areas.includes('admin') &&
      !usuario.areas.includes('recrutamento')
    ) {
      throw new ForbiddenException(
        'Apenas recrutamento pode consultar o banco de talentos.',
      );
    }

    let limite = 20;
    if (limiteStr) {
      const n = Number(limiteStr);
      if (!Number.isInteger(n) || n < 1 || n > 100) {
        throw new BadRequestException('limite deve estar entre 1 e 100.');
      }
      limite = n;
    }

    // Piso: env define o padrão da instalação; a query pode baixá-lo pontualmente
    // (a UI oferece "ver os mais próximos mesmo assim" quando não passa ninguém).
    let minSimilaridade = this.config.get<number>(
      'TALENTOS_SIMILARIDADE_MINIMA',
      SIMILARIDADE_MINIMA_PADRAO,
    );
    if (minStr !== undefined) {
      const n = Number(minStr);
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        throw new BadRequestException(
          'minSimilaridade deve estar entre 0 e 100.',
        );
      }
      minSimilaridade = n;
    }
    // Similaridade = (1 - dist/2) × 100  ⇒  dist = 2 × (1 - sim/100).
    const distanciaMaxima = 2 * (1 - minSimilaridade / 100);

    const vaga = await this.prisma.vaga.findFirst({
      where: { id },
      select: { id: true, titulo: true },
    });
    if (!vaga) throw new NotFoundException(`Vaga ${id} não existe.`);

    const [vetorVaga] = await this.prisma.$queryRaw<Array<{ n: bigint }>>(
      Prisma.sql`SELECT count(*) AS n FROM embeddings WHERE vaga_id = ${id}::uuid`,
    );
    if (Number(vetorVaga?.n ?? 0) === 0) {
      return {
        vaga,
        vagaSemVetor: true,
        totalPool: 0,
        minSimilaridade,
        melhorDescartado: null,
        itens: [],
      };
    }

    // Um candidato pode ter mais de uma inscrição no banco de talentos (pool
    // antigo + novo). `DISTINCT ON (ca.id)` mantém só a mais próxima da vaga,
    // senão a mesma pessoa apareceria repetida na lista.
    const rows = await this.prisma.$queryRaw<
      Array<{
        candidato_id: string;
        candidatura_pool_id: string;
        nome_completo: string;
        email: string | null;
        telefone: string | null;
        cidade: string | null;
        estado: string | null;
        vaga_pool_titulo: string;
        inscrito_em: Date | null;
        anos_experiencia: number | null;
        resumo: string | null;
        distancia: number;
      }>
    >(Prisma.sql`
      WITH ev AS (
        SELECT vetor FROM embeddings
        WHERE vaga_id = ${id}::uuid
        ORDER BY criado_em DESC LIMIT 1
      )
      SELECT * FROM (
        SELECT DISTINCT ON (ca.id)
          ca.id                AS candidato_id,
          c2.id                AS candidatura_pool_id,
          ca.nome_completo,
          ca.email,
          ca.telefone,
          ca.cidade,
          ca.estado,
          v2.titulo            AS vaga_pool_titulo,
          c2.inscrito_em,
          cp.anos_experiencia,
          cp.resumo,
          (ec.vetor <=> (SELECT vetor FROM ev))::float8 AS distancia
        FROM candidaturas c2
        JOIN vagas v2
          ON v2.id = c2.vaga_id
         AND v2.tipo_contrato = ${TIPO_BANCO_TALENTOS}
         AND v2.excluido_em IS NULL
         AND v2.id <> ${id}::uuid
        JOIN candidatos ca
          ON ca.id = c2.candidato_id
         AND ca.excluido_em IS NULL
        JOIN curriculos_processados cp ON cp.candidatura_id = c2.id
        JOIN LATERAL (
          SELECT e.vetor FROM embeddings e
          WHERE e.curriculo_id = cp.id
          ORDER BY e.criado_em DESC LIMIT 1
        ) ec ON TRUE
        WHERE EXISTS (SELECT 1 FROM ev)
          -- Já é candidato desta vaga → não é "sugestão", já está na lista.
          AND NOT EXISTS (
            SELECT 1 FROM candidaturas c3
            WHERE c3.vaga_id = ${id}::uuid AND c3.candidato_id = ca.id
          )
          -- Quem já foi descartado/contratado no próprio pool sai da sugestão.
          AND c2.status NOT IN ('REPROVADO', 'DESISTENTE', 'CONTRATADO')
        ORDER BY ca.id, distancia ASC
      ) t
      ORDER BY t.distancia ASC
      LIMIT ${limite}
    `);

    // Tamanho do banco de talentos elegível (para a UI dizer "20 de 137").
    const [pool] = await this.prisma.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`
      SELECT count(DISTINCT ca.id) AS n
      FROM candidaturas c2
      JOIN vagas v2
        ON v2.id = c2.vaga_id
       AND v2.tipo_contrato = ${TIPO_BANCO_TALENTOS}
       AND v2.excluido_em IS NULL
       AND v2.id <> ${id}::uuid
      JOIN candidatos ca ON ca.id = c2.candidato_id AND ca.excluido_em IS NULL
      JOIN curriculos_processados cp ON cp.candidatura_id = c2.id
      WHERE EXISTS (SELECT 1 FROM embeddings e WHERE e.curriculo_id = cp.id)
        AND c2.status NOT IN ('REPROVADO', 'DESISTENTE', 'CONTRATADO')
    `);

    const paraItem = (r: (typeof rows)[number]) => ({
      candidatoId: r.candidato_id,
      candidaturaPoolId: r.candidatura_pool_id,
      candidatoNome: r.nome_completo,
      email: r.email,
      telefone: r.telefone,
      cidade: r.cidade,
      estado: r.estado,
      vagaPoolTitulo: r.vaga_pool_titulo,
      inscritoEm: r.inscrito_em,
      anosExperiencia: r.anos_experiencia,
      resumo: r.resumo,
      // Mesma conversão do ranking: distância cosseno [0,2] → 0..100.
      similaridade: Math.max(
        0,
        Math.min(100, (1 - Number(r.distancia) / 2) * 100),
      ),
    });

    // O corte é aplicado AQUI e não no SQL de propósito: as linhas já vêm
    // ordenadas por distância, então basta partir a lista no piso — e o primeiro
    // que ficou de fora vira `melhorDescartado`, que a UI usa para explicar
    // "o mais próximo do banco chegou a 76, abaixo do piso de 80". Sem isso, a
    // aba vazia não diz se o banco está vazio ou se ninguém passou no corte.
    const aprovados = rows.filter((r) => Number(r.distancia) <= distanciaMaxima);
    const primeiroDeFora = rows.find(
      (r) => Number(r.distancia) > distanciaMaxima,
    );

    return {
      vaga,
      vagaSemVetor: false,
      totalPool: Number(pool?.n ?? 0),
      minSimilaridade,
      melhorDescartado: primeiroDeFora
        ? paraItem(primeiroDeFora).similaridade
        : null,
      itens: aprovados.map(paraItem),
    };
  }

  /**
   * PUXAR alguém do banco de talentos para ESTA vaga.
   *
   * Cria uma candidatura local (`origem = BANCO_TALENTOS`, sem `gupy_id`) para
   * que a pessoa entre no fluxo normal — nota da IA, etapas, entrevista — sem
   * deixar de ser identificável como indicação, não inscrição.
   *
   * Copia o currículo processado e o embedding da candidatura do banco em vez de
   * reprocessar: é o MESMO texto, então recalcular gastaria Voyage/Claude para
   * chegar ao mesmo vetor. Assim a pessoa já nasce rankeável a custo zero.
   *
   * Idempotente: se a pessoa já é candidata da vaga, devolve a candidatura
   * existente em vez de estourar no unique (vaga_id, candidato_id).
   */
  @Post(':id/talentos/:candidatoId/puxar')
  async puxarTalento(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('id') id: string,
    @Param('candidatoId') candidatoId: string,
  ) {
    if (!UUID_REGEX.test(id) || !UUID_REGEX.test(candidatoId)) {
      throw new BadRequestException('id inválido.');
    }
    if (
      !usuario.areas.includes('admin') &&
      !usuario.areas.includes('recrutamento')
    ) {
      throw new ForbiddenException(
        'Apenas recrutamento pode puxar alguém do banco de talentos.',
      );
    }

    const vaga = await this.prisma.vaga.findFirst({
      where: { id },
      select: { id: true, titulo: true },
    });
    if (!vaga) throw new NotFoundException(`Vaga ${id} não existe.`);

    const jaExiste = await this.prisma.candidatura.findUnique({
      where: { vaga_id_candidato_id: { vaga_id: id, candidato_id: candidatoId } },
      select: { id: true, origem: true },
    });
    if (jaExiste) {
      return {
        candidaturaId: jaExiste.id,
        origem: jaExiste.origem,
        jaExistia: true,
      };
    }

    // A candidatura de ORIGEM precisa ser mesmo do banco de talentos — sem isso
    // este endpoint viraria uma porta para copiar candidato de vaga comum, que
    // é justamente o que a minimização LGPD proíbe.
    const origemPool = await this.prisma.candidatura.findFirst({
      where: {
        candidato_id: candidatoId,
        vaga: { tipo_contrato: TIPO_BANCO_TALENTOS, excluido_em: null },
        candidato: { excluido_em: null },
        curriculo: { isNot: null },
      },
      orderBy: { inscrito_em: 'desc' },
      select: {
        id: true,
        curriculo: {
          select: {
            id: true,
            arquivo_url: true,
            arquivo_sha256: true,
            texto_bruto: true,
            texto_normalizado: true,
            resumo: true,
            experiencias: true,
            formacoes: true,
            competencias: true,
            idiomas: true,
            certificacoes: true,
            anos_experiencia: true,
            parser_versao: true,
          },
        },
      },
    });
    if (!origemPool?.curriculo) {
      throw new NotFoundException(
        'Candidato não está no banco de talentos (ou está sem currículo processado).',
      );
    }
    const cv = origemPool.curriculo;

    const criada = await this.prisma.$transaction(async (tx) => {
      const candidatura = await tx.candidatura.create({
        data: {
          gupy_id: null,
          vaga_id: id,
          candidato_id: candidatoId,
          origem: 'BANCO_TALENTOS',
          status: 'EM_ANALISE',
          // Sem etapa: a pessoa não está no funil da Gupy. A tela mostra isso
          // na sub-aba "Sem etapa" até alguém movê-la.
          etapa_gupy: null,
          inscrito_em: new Date(),
          puxado_por: usuario.id,
          puxado_em: new Date(),
        },
        select: { id: true },
      });

      const novoCv = await tx.curriculoProcessado.create({
        data: {
          candidatura_id: candidatura.id,
          candidato_id: candidatoId,
          arquivo_url: cv.arquivo_url,
          arquivo_sha256: cv.arquivo_sha256,
          texto_bruto: cv.texto_bruto,
          texto_normalizado: cv.texto_normalizado,
          resumo: cv.resumo,
          experiencias: cv.experiencias ?? Prisma.DbNull,
          formacoes: cv.formacoes ?? Prisma.DbNull,
          competencias: cv.competencias,
          idiomas: cv.idiomas ?? Prisma.DbNull,
          certificacoes: cv.certificacoes ?? Prisma.DbNull,
          anos_experiencia: cv.anos_experiencia,
          parser_versao: cv.parser_versao,
        },
        select: { id: true },
      });

      // Copia o vetor (mesmo texto ⇒ mesmo embedding). `vetor` é coluna
      // Unsupported no Prisma, então a cópia é em SQL bruto.
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO embeddings (id, curriculo_id, trecho, vetor, modelo, modelo_versao, criado_em)
        SELECT gen_random_uuid(), ${novoCv.id}::uuid, e.trecho, e.vetor, e.modelo, e.modelo_versao, now()
        FROM embeddings e
        WHERE e.curriculo_id = ${cv.id}::uuid
        ORDER BY e.criado_em DESC
        LIMIT 1
      `);

      return candidatura;
    });

    return { candidaturaId: criada.id, origem: 'BANCO_TALENTOS', jaExistia: false };
  }
}
