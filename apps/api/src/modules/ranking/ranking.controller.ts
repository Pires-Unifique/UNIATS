import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

import { AuthGuard } from '../auth/auth.guard.js';
import { AuthService } from '../auth/auth.service.js';
import type { UsuarioAutenticado } from '../auth/auth.types.js';
import { UsuarioAtual } from '../auth/usuario-atual.decorator.js';
import { RankingService } from './ranking.service.js';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Recrutamento (leitura E ações) escopado por POSSE da vaga: admin/recrutamento
 * acessam tudo; o GESTOR faz as MESMAS operações, mas só na(s) vaga(s) dele e
 * nos candidatos delas. Por isso usamos assertVaga/assertCandidatura (que já
 * libera admin/recrutamento e o gestor-dono) em todos os endpoints, em vez de
 * restringir por área.
 */
@Controller('api')
@UseGuards(ThrottlerGuard, AuthGuard)
export class RankingController {
  constructor(
    private readonly service: RankingService,
    private readonly auth: AuthService,
  ) {}

  /** Ranking persistido (top-K). Não dispara recálculo. */
  @Get('vagas/:vagaId/ranking')
  async ranking(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('vagaId') vagaId: string,
    @Query('limite') limiteStr?: string,
  ) {
    if (!UUID_REGEX.test(vagaId)) {
      throw new BadRequestException('vagaId inválido.');
    }
    await this.auth.assertVagaPermitida(usuario, vagaId);
    let limite: number | undefined;
    if (limiteStr) {
      const n = Number(limiteStr);
      if (!Number.isInteger(n) || n < 1 || n > 200) {
        throw new BadRequestException('limite deve estar entre 1 e 200.');
      }
      limite = n;
    }
    return this.service.listarRankingVaga(vagaId, limite);
  }

  /** Detalha os 3 scores (SIMILARIDADE, RANKING_CV, CONSOLIDADO) de uma candidatura. */
  @Get('candidaturas/:candidaturaId/score')
  async score(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('candidaturaId') candidaturaId: string,
  ) {
    if (!UUID_REGEX.test(candidaturaId)) {
      throw new BadRequestException('candidaturaId inválido.');
    }
    await this.auth.assertCandidaturaPermitida(usuario, candidaturaId);
    return this.service.detalheScore(candidaturaId);
  }

  /** Força recálculo de toda a vaga (cara). */
  @Post('vagas/:vagaId/reranking')
  async rerank(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('vagaId') vagaId: string,
  ) {
    if (!UUID_REGEX.test(vagaId)) {
      throw new BadRequestException('vagaId inválido.');
    }
    await this.auth.assertVagaPermitida(usuario, vagaId);
    return this.service.rerankearVaga(vagaId);
  }

  /**
   * Fluxo vetorial — Fase 1: gera embeddings (Voyage) da vaga + CVs faltantes,
   * SEM rodar o Claude. Barato. Acompanhe via .../vetorial/status.
   */
  @Post('vagas/:vagaId/vetorial/preparar')
  async prepararVetorial(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('vagaId') vagaId: string,
  ) {
    if (!UUID_REGEX.test(vagaId)) {
      throw new BadRequestException('vagaId inválido.');
    }
    await this.auth.assertVagaPermitida(usuario, vagaId);
    return this.service.prepararVetorial(vagaId);
  }

  /**
   * Fluxo vetorial — Fase 1 RÁPIDA: embedding em LOTE (vaga + todos os CVs em
   * poucas chamadas ao Voyage). Síncrono — retorna quando os vetores estão prontos.
   */
  @Post('vagas/:vagaId/vetorial/preparar-lote')
  async prepararVetorialLote(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('vagaId') vagaId: string,
    @Body() body: { incluirReprovados?: boolean },
  ) {
    if (!UUID_REGEX.test(vagaId)) {
      throw new BadRequestException('vagaId inválido.');
    }
    await this.auth.assertVagaPermitida(usuario, vagaId);
    return this.service.prepararVetorialLote(vagaId, body?.incluirReprovados === true);
  }

  /** Status do fluxo vetorial (embedados x avaliados pelo Claude). */
  @Get('vagas/:vagaId/vetorial/status')
  async statusVetorial(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('vagaId') vagaId: string,
    @Query('incluirReprovados') incluirReprovados?: string,
  ) {
    if (!UUID_REGEX.test(vagaId)) {
      throw new BadRequestException('vagaId inválido.');
    }
    await this.auth.assertVagaPermitida(usuario, vagaId);
    return this.service.statusVetorial(vagaId, incluirReprovados === 'true');
  }

  /**
   * Fluxo vetorial — Fase 2: dispara em BACKGROUND a avaliação Claude dos
   * próximos N candidatos por similaridade vetorial ainda não avaliados.
   * Retorna na hora; o progresso vem de .../avaliar-proximos/status (polling).
   * Síncrono não dava: a rodada paralela dura o tempo da chamada Claude MAIS
   * LENTA (retries podem passar de 60s) e estourava o timeout do proxy.
   */
  @Post('vagas/:vagaId/vetorial/avaliar-proximos')
  async avaliarProximos(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('vagaId') vagaId: string,
    @Body() body: { n?: number; incluirReprovados?: boolean },
  ) {
    if (!UUID_REGEX.test(vagaId)) {
      throw new BadRequestException('vagaId inválido.');
    }
    await this.auth.assertVagaPermitida(usuario, vagaId);
    const n = Number(body?.n ?? 10);
    if (!Number.isInteger(n) || n < 1 || n > 100) {
      throw new BadRequestException('n deve ser inteiro entre 1 e 100.');
    }
    return this.service.iniciarAvaliarProximos(
      vagaId,
      n,
      body?.incluirReprovados === true,
    );
  }

  /** Progresso da Fase 2 (para polling do frontend). */
  @Get('vagas/:vagaId/vetorial/avaliar-proximos/status')
  async avaliarProximosStatus(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('vagaId') vagaId: string,
    @Query('incluirReprovados') incluirReprovados?: string,
  ) {
    if (!UUID_REGEX.test(vagaId)) {
      throw new BadRequestException('vagaId inválido.');
    }
    await this.auth.assertVagaPermitida(usuario, vagaId);
    return this.service.statusAvaliarProximos(
      vagaId,
      incluirReprovados === 'true',
    );
  }

  /**
   * Dispara a classificação de TODA a vaga via Claude (sem Voyage).
   * Roda em background e retorna na hora; acompanhe via .../classificar/status.
   */
  @Post('vagas/:vagaId/classificar')
  async classificar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('vagaId') vagaId: string,
    @Body() body?: { somentePendentes?: boolean },
  ) {
    if (!UUID_REGEX.test(vagaId)) {
      throw new BadRequestException('vagaId inválido.');
    }
    await this.auth.assertVagaPermitida(usuario, vagaId);
    return this.service.iniciarClassificacaoVagaLLM(
      vagaId,
      body?.somentePendentes === true,
    );
  }

  /** Progresso da classificação (para polling do frontend). */
  @Get('vagas/:vagaId/classificar/status')
  async classificarStatus(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('vagaId') vagaId: string,
  ) {
    if (!UUID_REGEX.test(vagaId)) {
      throw new BadRequestException('vagaId inválido.');
    }
    await this.auth.assertVagaPermitida(usuario, vagaId);
    return this.service.statusClassificacao(vagaId);
  }

  /** Calcula score de UMA candidatura de forma síncrona (espera LLM). */
  @Post('candidaturas/:candidaturaId/score/calcular')
  async calcularAgora(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('candidaturaId') candidaturaId: string,
  ) {
    if (!UUID_REGEX.test(candidaturaId)) {
      throw new BadRequestException('candidaturaId inválido.');
    }
    await this.auth.assertCandidaturaPermitida(usuario, candidaturaId);
    return this.service.scorearAgora(candidaturaId);
  }

  /**
   * Aprovação humana (LGPD Art. 20). Usa o usuário autenticado como revisor.
   */
  @Post('candidaturas/:candidaturaId/score/aprovar')
  async aprovar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('candidaturaId') candidaturaId: string,
  ) {
    if (!UUID_REGEX.test(candidaturaId)) {
      throw new BadRequestException('candidaturaId inválido.');
    }
    await this.auth.assertCandidaturaPermitida(usuario, candidaturaId);
    return this.service.aprovarScore(candidaturaId, usuario.id);
  }
}
