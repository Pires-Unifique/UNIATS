import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { Prisma } from '@triagem/db';

import { EmbeddingService } from './services/embedding.service.js';
import { MatchingService } from './services/matching.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { QUEUE_NAMES } from '../../queue/queue.module.js';

@Injectable()
export class RankingService {
  private readonly logger = new Logger(RankingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly matching: MatchingService,
    private readonly embeddings: EmbeddingService,
    @InjectQueue(QUEUE_NAMES.EMBEDDING) private readonly filaEmbedding: Queue,
    @InjectQueue(QUEUE_NAMES.MATCHING) private readonly filaMatching: Queue,
  ) {}

  /**
   * Embedding EM LOTE (síncrono): embeda a vaga + todos os CVs em poucas chamadas
   * ao Voyage (lotes de 128), em vez de 1 por CV. Retorna quando os vetores estão
   * gravados — então o frontend pode chamar avaliar-proximos logo em seguida.
   */
  async prepararVetorialLote(vagaId: string, incluirReprovados = false) {
    const vaga = await this.prisma.vaga.findUnique({
      where: { id: vagaId },
      select: { id: true },
    });
    if (!vaga) throw new NotFoundException(`Vaga ${vagaId} não existe.`);
    return this.embeddings.embedarVagaEmLote(vagaId, { incluirReprovados });
  }

  /**
   * Ranking top-K já calculado e persistido em `scores`.
   * Não dispara recálculo — é uma leitura barata.
   */
  async listarRankingVaga(vagaId: string, limite?: number) {
    const vaga = await this.prisma.vaga.findUnique({
      where: { id: vagaId },
      select: { id: true, titulo: true },
    });
    if (!vaga) throw new NotFoundException(`Vaga ${vagaId} não existe.`);

    const itens = await this.matching.listarRankingVaga(vagaId, limite);
    return {
      vaga,
      total: itens.length,
      itens,
    };
  }

  async detalheScore(candidaturaId: string) {
    const scores = await this.prisma.score.findMany({
      where: { candidatura_id: candidaturaId },
      orderBy: { criado_em: 'desc' },
      select: {
        tipo: true,
        valor: true,
        justificativa: true,
        evidencias: true,
        modelo: true,
        prompt_versao: true,
        revisado_por: true,
        revisado_em: true,
        criado_em: true,
      },
    });
    if (!scores.length) {
      throw new NotFoundException(
        'Nenhum score calculado para esta candidatura.',
      );
    }
    return { candidaturaId, scores };
  }

  /**
   * Re-rank de TODA a vaga: enfileira embedding da vaga (se faltar) +
   * embedding + matching de cada candidatura que tem currículo processado.
   * Operação cara — uso esperado: ao subir prompt/versao do parser ou ao
   * editar requisitos da vaga.
   */
  async rerankearVaga(vagaId: string): Promise<{
    vagaId: string;
    jobsCriados: number;
  }> {
    const vaga = await this.prisma.vaga.findUnique({
      where: { id: vagaId },
      select: { id: true },
    });
    if (!vaga) throw new NotFoundException(`Vaga ${vagaId} não existe.`);

    // Embedding da vaga primeiro — o resto depende disso.
    await this.filaEmbedding.add(
      'embedding-vaga',
      { alvo: 'vaga', vagaId },
      { jobId: `emb-vaga-${vagaId}-${Date.now()}` },
    );

    const candidaturas = await this.prisma.candidatura.findMany({
      where: {
        vaga_id: vagaId,
        curriculo: { isNot: null },
      },
      select: { id: true, curriculo: { select: { parser_versao: true } } },
    });

    let jobs = 1;
    for (const c of candidaturas) {
      if (
        !c.curriculo?.parser_versao ||
        c.curriculo.parser_versao === 'pending'
      ) {
        continue; // CV ainda não estruturado — fora deste ciclo
      }
      await this.filaEmbedding.add(
        'embedding-curriculo',
        { alvo: 'curriculo', candidaturaId: c.id },
        { jobId: `emb-cv-${c.id}-${Date.now()}` },
      );
      jobs++;
    }

    this.logger.log(`Re-rank enfileirado: vaga=${vagaId} jobs=${jobs}`);
    return { vagaId, jobsCriados: jobs };
  }

  /**
   * Fase 1 do fluxo vetorial: garante o embedding (Voyage) da vaga + dos CVs
   * que AINDA não têm vetor. NÃO dispara o Claude (cascataMatching=false).
   * Barato e idempotente: re-rodar só embeda o que falta.
   */
  async prepararVetorial(vagaId: string): Promise<{
    vagaId: string;
    jobsCriados: number;
    jaEmbedados: number;
  }> {
    const vaga = await this.prisma.vaga.findUnique({
      where: { id: vagaId },
      select: { id: true },
    });
    if (!vaga) throw new NotFoundException(`Vaga ${vagaId} não existe.`);

    // Embedding da vaga (sempre — reflete edição de requisitos).
    await this.filaEmbedding.add(
      'embedding-vaga',
      { alvo: 'vaga', vagaId },
      { jobId: `emb-vaga-${vagaId}-${Date.now()}`, priority: 1 },
    );
    let jobs = 1;

    // CVs que JÁ têm embedding (para pular e economizar chamadas Voyage).
    const jaRows = await this.prisma.$queryRaw<
      Array<{ candidatura_id: string }>
    >(Prisma.sql`
      SELECT DISTINCT cp.candidatura_id
      FROM embeddings e
      JOIN curriculos_processados cp ON cp.id = e.curriculo_id
      JOIN candidaturas c ON c.id = cp.candidatura_id
      WHERE c.vaga_id = ${vagaId}::uuid AND e.curriculo_id IS NOT NULL
    `);
    const jaEmbedados = new Set(jaRows.map((r) => r.candidatura_id));

    const candidaturas = await this.prisma.candidatura.findMany({
      where: { vaga_id: vagaId, curriculo: { isNot: null } },
      select: { id: true, curriculo: { select: { parser_versao: true } } },
    });

    const stamp = Date.now();
    for (const c of candidaturas) {
      if (!c.curriculo?.parser_versao || c.curriculo.parser_versao === 'pending') {
        continue;
      }
      if (jaEmbedados.has(c.id)) continue; // já tem vetor — não re-embeda
      await this.filaEmbedding.add(
        'embedding-curriculo',
        { alvo: 'curriculo', candidaturaId: c.id, cascataMatching: false },
        { jobId: `emb-cv-${c.id}-${stamp}`, priority: 1 },
      );
      jobs++;
    }

    this.logger.log(
      `Preparo vetorial: vaga=${vagaId} jobs=${jobs} jaEmbedados=${jaEmbedados.size}`,
    );
    return { vagaId, jobsCriados: jobs, jaEmbedados: jaEmbedados.size };
  }

  /** Status do fluxo vetorial (CVs embedados x avaliados pelo Claude). */
  async statusVetorial(vagaId: string, incluirReprovados = false) {
    return this.matching.statusVetorial(vagaId, incluirReprovados);
  }

  /**
   * Fase 2: avalia com Claude os próximos N candidatos por similaridade vetorial
   * que ainda não foram avaliados (top-N inicial e lotes seguintes).
   */
  async avaliarProximosLLM(vagaId: string, n: number, incluirReprovados = false) {
    return this.matching.avaliarProximosLLM(vagaId, n, incluirReprovados);
  }

  /**
   * Scoreia UMA candidatura sob demanda (síncrono — espera o LLM).
   * Útil para botão "calcular agora" no painel quando a fila está atrasada.
   */
  async scorearAgora(candidaturaId: string) {
    return this.matching.scorearCandidatura(candidaturaId);
  }

  /** Classifica UMA candidatura usando só o Claude (sem Voyage). */
  async classificarAgoraLLM(candidaturaId: string) {
    return this.matching.classificarCandidaturaLLM(candidaturaId);
  }

  // Vagas com classificação em andamento (in-memory; suficiente p/ 1 instância).
  private readonly classificando = new Set<string>();

  /**
   * Dispara a classificação da vaga em BACKGROUND e retorna na hora.
   * O frontend acompanha via `statusClassificacao` (polling).
   */
  async iniciarClassificacaoVagaLLM(vagaId: string): Promise<{
    iniciado: boolean;
    jaEmAndamento: boolean;
    total: number;
    classificados: number;
  }> {
    const vaga = await this.prisma.vaga.findUnique({
      where: { id: vagaId },
      select: { id: true },
    });
    if (!vaga) throw new NotFoundException(`Vaga ${vagaId} não existe.`);

    const status = await this.statusClassificacao(vagaId);

    if (this.classificando.has(vagaId)) {
      return { iniciado: false, jaEmAndamento: true, ...status };
    }

    this.classificando.add(vagaId);
    // Fire-and-forget: não await. Erros são logados; o Set é liberado no fim.
    void this.matching
      .classificarVagaLLM(vagaId)
      .catch((err) =>
        this.logger.error(
          `Classificação da vaga ${vagaId} falhou: ${(err as Error).message}`,
        ),
      )
      .finally(() => this.classificando.delete(vagaId));

    return { iniciado: true, jaEmAndamento: false, ...status };
  }

  /** Progresso da classificação de uma vaga. */
  async statusClassificacao(vagaId: string): Promise<{
    total: number;
    classificados: number;
    emAndamento: boolean;
  }> {
    const [total, classificados] = await Promise.all([
      this.prisma.candidatura.count({
        where: { vaga_id: vagaId, curriculo: { isNot: null } },
      }),
      this.prisma.candidatura.count({
        where: {
          vaga_id: vagaId,
          curriculo: { isNot: null },
          scores: { some: { tipo: 'CONSOLIDADO' } },
        },
      }),
    ]);
    return { total, classificados, emAndamento: this.classificando.has(vagaId) };
  }

  /**
   * Permite que recrutador "aprove" a avaliação automática (LGPD Art. 20:
   * revisão humana de decisões automatizadas).
   */
  async aprovarScore(
    candidaturaId: string,
    usuarioId: string,
  ): Promise<{ atualizados: number }> {
    // GUID genérico (8-4-4-4-12). NÃO exigimos os bits de versão/variante da
    // RFC-4122: o Object ID do Azure AD é um GUID que nem sempre os respeita,
    // e o Postgres (coluna @db.Uuid) aceita qualquer GUID nesse formato.
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        usuarioId,
      )
    ) {
      throw new BadRequestException('usuarioId inválido.');
    }
    const r = await this.prisma.score.updateMany({
      where: {
        candidatura_id: candidaturaId,
        tipo: { in: ['RANKING_CV', 'CONSOLIDADO'] },
      },
      data: { revisado_por: usuarioId, revisado_em: new Date() },
    });
    return { atualizados: r.count };
  }
}
