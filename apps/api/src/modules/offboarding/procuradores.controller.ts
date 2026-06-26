import {
  BadRequestException,
  Body,
  Controller,
  Delete,
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
import { ProcuradoresService } from './procuradores.service.js';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertUuid(id: string, campo = 'id'): void {
  if (!UUID_REGEX.test(id)) throw new BadRequestException(`${campo} inválido.`);
}

/**
 * Catálogo de procuradores. Leitura liberada a qualquer autenticado (alimenta o
 * picker da assinatura física); escrita restrita ao DHO/admin.
 */
@Controller('api/offboarding/procuradores')
@UseGuards(ThrottlerGuard, AuthGuard, AreasGuard)
export class ProcuradoresController {
  constructor(private readonly service: ProcuradoresService) {}

  @Get()
  async listar(@Query('q') q?: string, @Query('inativos') inativos?: string) {
    return this.service.listar(q?.trim() || undefined, inativos === '1');
  }

  @Post()
  @Areas('dho')
  async criar(
    @Body()
    body: {
      nome?: string;
      email?: string | null;
      documento?: string | null;
      cargo?: string | null;
      observacao?: string | null;
    },
  ) {
    if (!body?.nome?.trim()) {
      throw new BadRequestException('nome é obrigatório.');
    }
    return this.service.criar({
      nome: body.nome,
      email: body.email,
      documento: body.documento,
      cargo: body.cargo,
      observacao: body.observacao,
    });
  }

  @Patch(':id')
  @Areas('dho')
  async atualizar(
    @Param('id') id: string,
    @Body()
    body: Partial<{
      nome: string;
      email: string | null;
      documento: string | null;
      cargo: string | null;
      observacao: string | null;
      ativo: boolean;
    }>,
  ) {
    assertUuid(id);
    return this.service.atualizar(id, body);
  }

  @Delete(':id')
  @Areas('dho')
  async remover(@Param('id') id: string) {
    assertUuid(id);
    return this.service.remover(id);
  }
}
