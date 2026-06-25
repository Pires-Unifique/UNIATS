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

import { Areas } from '../auth/areas.decorator.js';
import { AreasGuard } from '../auth/areas.guard.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { CatalogoService, type CargoCsvRow } from './catalogo.service.js';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertUuid(id: string, campo = 'id'): void {
  if (!UUID_REGEX.test(id)) throw new BadRequestException(`${campo} inválido.`);
}

/**
 * Catálogo do módulo: cargos (próprio) e colaboradores/centros de custo/unidades
 * (view do Senior). Leitura liberada a qualquer autenticado (alimenta os
 * pickers do formulário); escrita de cargos e SYNC restritos ao DHO/admin.
 */
@Controller('api/alteracao-contratual/catalogo')
@UseGuards(ThrottlerGuard, AuthGuard, AreasGuard)
export class CatalogoController {
  constructor(private readonly service: CatalogoService) {}

  // -------- cargos --------

  @Get('cargos')
  async listarCargos(@Query('q') q?: string, @Query('inativos') inativos?: string) {
    return this.service.listarCargos(q?.trim() || undefined, inativos === '1');
  }

  @Post('cargos')
  @Areas('dho')
  async criarCargo(
    @Body()
    body: {
      titulo?: string;
      codigo?: string | null;
      senioridade?: string | null;
      descricao?: string | null;
    },
  ) {
    if (!body?.titulo?.trim()) {
      throw new BadRequestException('titulo é obrigatório.');
    }
    return this.service.criarCargo({
      titulo: body.titulo,
      codigo: body.codigo,
      senioridade: body.senioridade,
      descricao: body.descricao,
    });
  }

  @Patch('cargos/:id')
  @Areas('dho')
  async atualizarCargo(
    @Param('id') id: string,
    @Body()
    body: Partial<{
      titulo: string;
      codigo: string | null;
      senioridade: string | null;
      descricao: string | null;
      ativo: boolean;
    }>,
  ) {
    assertUuid(id);
    return this.service.atualizarCargo(id, body);
  }

  /** Importa o catálogo do CSV do SharePoint (idempotente). */
  @Post('cargos/importar')
  @Areas('dho')
  async importarCargos(@Body() body: { cargos?: CargoCsvRow[] }) {
    if (!Array.isArray(body?.cargos) || body.cargos.length === 0) {
      throw new BadRequestException('Envie `cargos` (lista do CSV).');
    }
    return this.service.importarCargosCsv(body.cargos);
  }

  @Post('cargos/:id/lotacoes')
  @Areas('dho')
  async definirLotacoes(
    @Param('id') id: string,
    @Body()
    body: {
      lotacoes?: Array<{ unidadeId?: string | null; centroCustoId?: string | null }>;
    },
  ) {
    assertUuid(id);
    return this.service.definirLotacoesCargo(id, body?.lotacoes ?? []);
  }

  // -------- referência (view do Senior, lidos do espelho) --------

  @Get('colaboradores')
  async colaboradores(@Query('q') q?: string) {
    return this.service.buscarColaboradores(q?.trim() || undefined);
  }

  @Get('unidades')
  async unidades(@Query('q') q?: string) {
    return this.service.listarUnidades(q?.trim() || undefined);
  }

  @Get('centros-custo')
  async centrosCusto(@Query('q') q?: string) {
    return this.service.listarCentrosCusto(q?.trim() || undefined);
  }

  // -------- sync (puxa das fontes externas) --------

  @Post('sync/unidades')
  @Areas('admin')
  async syncUnidades() {
    return this.service.sincronizarUnidades();
  }

  @Post('sync/centros-custo')
  @Areas('admin')
  async syncCentrosCusto() {
    return this.service.sincronizarCentrosCusto();
  }

  @Post('sync/colaboradores')
  @Areas('admin')
  async syncColaboradores() {
    return this.service.sincronizarColaboradores();
  }
}
