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

import { RankingService } from './ranking.service.js';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Controller('api')
@UseGuards(ThrottlerGuard)
export class RankingController {
  constructor(private readonly service: RankingService) {}

  /** Ranking persistido (top-K). Não dispara recálculo. */
  @Get('vagas/:vagaId/ranking')
  async ranking(
    @Param('vagaId') vagaId: string,
    @Query('limite') limiteStr?: string,
  ) {
    if (!UUID_REGEX.test(vagaId)) {
      throw new BadRequestException('vagaId inválido.');
    }
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
  async score(@Param('candidaturaId') candidaturaId: string) {
    if (!UUID_REGEX.test(candidaturaId)) {
      throw new BadRequestException('candidaturaId inválido.');
    }
    return this.service.detalheScore(candidaturaId);
  }

  /** Força recálculo de toda a vaga (cara). */
  @Post('vagas/:vagaId/reranking')
  async rerank(@Param('vagaId') vagaId: string) {
    if (!UUID_REGEX.test(vagaId)) {
      throw new BadRequestException('vagaId inválido.');
    }
    return this.service.rerankearVaga(vagaId);
  }

  /**
   * Dispara a classificação de TODA a vaga via Claude (sem Voyage).
   * Roda em background e retorna na hora; acompanhe via .../classificar/status.
   */
  @Post('vagas/:vagaId/classificar')
  async classificar(@Param('vagaId') vagaId: string) {
    if (!UUID_REGEX.test(vagaId)) {
      throw new BadRequestException('vagaId inválido.');
    }
    return this.service.iniciarClassificacaoVagaLLM(vagaId);
  }

  /** Progresso da classificação (para polling do frontend). */
  @Get('vagas/:vagaId/classificar/status')
  async classificarStatus(@Param('vagaId') vagaId: string) {
    if (!UUID_REGEX.test(vagaId)) {
      throw new BadRequestException('vagaId inválido.');
    }
    return this.service.statusClassificacao(vagaId);
  }

  /** Calcula score de UMA candidatura de forma síncrona (espera LLM). */
  @Post('candidaturas/:candidaturaId/score/calcular')
  async calcularAgora(@Param('candidaturaId') candidaturaId: string) {
    if (!UUID_REGEX.test(candidaturaId)) {
      throw new BadRequestException('candidaturaId inválido.');
    }
    return this.service.scorearAgora(candidaturaId);
  }

  /**
   * Aprovação humana (LGPD Art. 20). Recebe usuarioId no body
   * porque o módulo de auth ainda não está plugado para extrair de claims do JWT.
   */
  @Post('candidaturas/:candidaturaId/score/aprovar')
  async aprovar(
    @Param('candidaturaId') candidaturaId: string,
    @Body() body: { usuarioId?: string },
  ) {
    if (!UUID_REGEX.test(candidaturaId)) {
      throw new BadRequestException('candidaturaId inválido.');
    }
    if (!body?.usuarioId) {
      throw new BadRequestException('usuarioId é obrigatório no body.');
    }
    return this.service.aprovarScore(candidaturaId, body.usuarioId);
  }
}
