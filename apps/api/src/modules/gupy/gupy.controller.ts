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

import { GupyService } from './gupy.service.js';
import { GupyClient } from './gupy.client.js';

/**
 * Endpoints REST INTERNOS para o frontend (recrutador) acionar
 * sincronização sob demanda. Protegidos por SSO Azure AD + RBAC
 * — o AzureAdAuthGuard será implementado no módulo de auth (fora do MVP de Camada 1).
 */
@Controller('api/gupy')
@UseGuards(ThrottlerGuard) // rate-limit defensivo
export class GupyController {
  constructor(
    private readonly service: GupyService,
    private readonly client: GupyClient,
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
    return this.client.listarEtapasDaVaga({ jobId: BigInt(gupyIdStr) });
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
    },
  ) {
    if (!/^\d+$/.test(gupyIdStr)) {
      throw new BadRequestException('gupyId deve ser numérico');
    }
    if (!/^\d+$/.test(applicationIdStr)) {
      throw new BadRequestException('applicationId deve ser numérico');
    }

    const { currentStepId, status, disapprovalReason, disapprovalReasonNotes } =
      body ?? {};

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

    return { movido: true };
  }

  @Post('sync/vaga/:gupyId')
  async sincronizarVaga(@Param('gupyId') gupyIdStr: string) {
    if (!/^\d+$/.test(gupyIdStr)) {
      throw new BadRequestException('gupyId deve ser numérico');
    }
    return this.service.sincronizarVaga(BigInt(gupyIdStr));
  }

  @Post('sync/vagas')
  async sincronizarTodas() {
    return this.service.sincronizarTodasAsVagas();
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
