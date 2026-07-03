import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

import { PrismaService } from '../../prisma/prisma.service.js';
import { Areas } from '../auth/areas.decorator.js';
import { AreasGuard } from '../auth/areas.guard.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { GupyService } from './gupy.service.js';
import { GupyClient } from './gupy.client.js';

/**
 * Endpoints REST INTERNOS para o frontend (recrutador) acionar sincronização
 * sob demanda. Integração com a Gupy é tarefa de recrutamento (área
 * 'recrutamento'; admin incluso) — o gestor não sincroniza.
 */
@Controller('api/gupy')
@UseGuards(ThrottlerGuard, AuthGuard, AreasGuard)
@Areas('recrutamento')
export class GupyController {
  constructor(
    private readonly service: GupyService,
    private readonly client: GupyClient,
    private readonly prisma: PrismaService,
  ) {}

  // ---- Leitura direta (passthrough autenticado) ----

  @Get('vagas')
  async listarVagas(@Query('status') status?: string, @Query('perPage') perPage?: string) {
    const pp = perPage ? Number(perPage) : 50;
    if (Number.isNaN(pp) || pp < 1 || pp > 100) {
      throw new BadRequestException('perPage deve estar entre 1 e 100');
    }
    return this.client.listarVagas({ status, perPage: pp });
  }

  @Get('vagas/:gupyId/candidaturas')
  async listarCandidaturas(
    @Param('gupyId') gupyIdStr: string,
    @Query('perPage') perPage?: string,
  ) {
    if (!/^\d+$/.test(gupyIdStr)) {
      throw new BadRequestException('gupyId deve ser numérico');
    }
    const pp = perPage ? Number(perPage) : 50;
    if (Number.isNaN(pp) || pp < 1 || pp > 100) {
      throw new BadRequestException('perPage deve estar entre 1 e 100');
    }
    return this.client.listarCandidaturasDaVaga({
      jobId: BigInt(gupyIdStr),
      perPage: pp,
    });
  }

  @Get('vagas/:gupyId/etapas')
  async listarEtapas(@Param('gupyId') gupyIdStr: string) {
    if (!/^\d+$/.test(gupyIdStr)) {
      throw new BadRequestException('gupyId deve ser numérico');
    }
    const etapas = await this.client.listarEtapasDaVaga({
      jobId: BigInt(gupyIdStr),
    });
    // O `id` vem como BigInt (idGupy) e não é serializável em JSON — converte
    // para number (ids de step cabem com folga no range seguro).
    return etapas.map((e) => ({ ...e, id: Number(e.id) }));
  }

  // ---- Estrutura organizacional (selects do formulário de publicação) ----

  @Get('estrutura/departamentos')
  async listarDepartamentos(@Query('q') q?: string) {
    return this.client.listarDepartamentos({ name: q?.trim() || undefined });
  }

  @Get('estrutura/cargos')
  async listarCargos(@Query('q') q?: string) {
    return this.client.listarCargos({ name: q?.trim() || undefined });
  }

  @Get('estrutura/filiais')
  async listarFiliais(@Query('q') q?: string) {
    return this.client.listarFiliais({ name: q?.trim() || undefined });
  }

  // ---- Sincronização (ações de escrita) ----

  /**
   * Move uma candidatura entre etapas e/ou altera seu status na Gupy.
   * Body: { currentStepId?, status?, disapprovalReason?, disapprovalReasonNotes? }
   */
  @Patch('vagas/:gupyId/candidaturas/:applicationId')
  async moverCandidatura(
    @Param('gupyId') gupyIdStr: string,
    @Param('applicationId') applicationIdStr: string,
    @Body()
    body: {
      currentStepId?: number | string;
      status?: string;
      disapprovalReason?: string;
      disapprovalReasonNotes?: string;
      /** Nome da etapa de destino — usado só para refletir localmente na UI. */
      etapaNome?: string;
    },
  ) {
    if (!/^\d+$/.test(gupyIdStr)) {
      throw new BadRequestException('gupyId deve ser numérico');
    }
    if (!/^\d+$/.test(applicationIdStr)) {
      throw new BadRequestException('applicationId deve ser numérico');
    }

    const {
      currentStepId,
      status,
      disapprovalReason,
      disapprovalReasonNotes,
      etapaNome,
    } = body ?? {};

    if (currentStepId === undefined && status === undefined) {
      throw new BadRequestException(
        'Informe currentStepId e/ou status no corpo da requisição',
      );
    }
    if (currentStepId !== undefined && !/^\d+$/.test(String(currentStepId))) {
      throw new BadRequestException('currentStepId deve ser numérico');
    }
    if (
      status !== undefined &&
      status !== 'in_process' &&
      status !== 'reproved'
    ) {
      throw new BadRequestException(
        "status deve ser 'in_process' ou 'reproved'",
      );
    }

    await this.client.moverCandidatura({
      jobId: BigInt(gupyIdStr),
      applicationId: BigInt(applicationIdStr),
      currentStepId:
        currentStepId !== undefined ? BigInt(currentStepId) : undefined,
      status: status as 'in_process' | 'reproved' | undefined,
      disapprovalReason,
      disapprovalReasonNotes,
    });

    // Reflete localmente o resultado do move (a UI/ranking não dependem de
    // re-sincronizar a vaga inteira). Best-effort: não falha a request se a
    // candidatura ainda não existir no banco local.
    const dadosLocais: { etapa_gupy?: string; status?: 'REPROVADO' } = {};
    if (etapaNome) dadosLocais.etapa_gupy = etapaNome;
    if (status === 'reproved') dadosLocais.status = 'REPROVADO';
    if (Object.keys(dadosLocais).length > 0) {
      await this.prisma.candidatura.updateMany({
        where: { gupy_id: BigInt(applicationIdStr) },
        data: dadosLocais,
      });
    }

    return { movido: true };
  }

  @Post('sync/vaga/:gupyId')
  async sincronizarVaga(@Param('gupyId') gupyIdStr: string) {
    if (!/^\d+$/.test(gupyIdStr)) {
      throw new BadRequestException('gupyId deve ser numérico');
    }
    return this.service.sincronizarVaga(BigInt(gupyIdStr));
  }

  /** Importa TODAS as vagas (background — retorna na hora, sem prender o proxy). */
  @Post('sync/vagas')
  async sincronizarTodas() {
    return this.service.iniciarSyncVagas();
  }

  /** Progresso do import de vagas em background. */
  @Get('sync/vagas/status')
  async statusSyncVagas() {
    return this.service.statusSyncVagas();
  }

  @Post('sync/vaga/:gupyId/candidaturas')
  async sincronizarCandidaturas(@Param('gupyId') gupyIdStr: string) {
    if (!/^\d+$/.test(gupyIdStr)) {
      throw new BadRequestException('gupyId deve ser numérico');
    }
    return this.service.sincronizarCandidaturasDaVaga(BigInt(gupyIdStr));
  }

  /** Importa candidaturas de TODAS as vagas (background). */
  @Post('sync/candidaturas-todas')
  async sincronizarCandidaturasTodas() {
    return this.service.iniciarSyncCandidaturasTodas();
  }

  /** Progresso do import em massa de candidaturas. */
  @Get('sync/candidaturas-todas/status')
  async statusCandidaturasTodas() {
    return this.service.statusBulkCandidaturas();
  }
}
