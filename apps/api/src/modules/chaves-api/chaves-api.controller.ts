import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

import { Areas } from '../auth/areas.decorator.js';
import { AreasGuard } from '../auth/areas.guard.js';
import { AuthGuard } from '../auth/auth.guard.js';
import type { UsuarioAutenticado } from '../auth/auth.types.js';
import { UsuarioAtual } from '../auth/usuario-atual.decorator.js';
import { ChavesApiService } from './chaves-api.service.js';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Gestão de chaves de API (tela da seção Sistema). Restrito a 'admin' — e como
 * chaves nunca têm escopo 'admin', uma chave não gera/revoga outras chaves.
 */
@Controller('api/chaves-api')
@UseGuards(ThrottlerGuard, AuthGuard, AreasGuard)
@Areas('admin')
export class ChavesApiController {
  constructor(private readonly service: ChavesApiService) {}

  @Get()
  async listar() {
    return this.service.listar();
  }

  @Post()
  async gerar(
    @Body()
    body: { nome?: string; escopos?: string[]; validade_dias?: number | null },
    @UsuarioAtual() autor: UsuarioAutenticado,
  ) {
    return this.service.gerar(body ?? {}, autor);
  }

  @Post(':id/revogar')
  async revogar(
    @Param('id') id: string,
    @UsuarioAtual() autor: UsuarioAutenticado,
  ) {
    if (!UUID_REGEX.test(id)) throw new BadRequestException('id inválido.');
    return this.service.revogar(id, autor);
  }
}
