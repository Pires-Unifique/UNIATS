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
import type { UsuarioAutenticado } from '../auth/auth.types.js';
import { UsuarioAtual } from '../auth/usuario-atual.decorator.js';
import { UsuariosService } from './usuarios.service.js';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertUuid(id: string, campo = 'id'): void {
  if (!UUID_REGEX.test(id)) throw new BadRequestException(`${campo} inválido.`);
}

/**
 * Tela de Usuários (seção Sistema) — gestão dos acessos amplos por área.
 * Tudo restrito a 'admin'. Chaves de API nunca chegam aqui (escopo 'admin'
 * é proibido para chaves).
 */
@Controller('api/usuarios')
@UseGuards(ThrottlerGuard, AuthGuard, AreasGuard)
@Areas('admin')
export class UsuariosController {
  constructor(private readonly service: UsuariosService) {}

  @Get()
  async listar(
    @Query('busca') busca?: string,
    @Query('inativos') inativos?: string,
  ) {
    return this.service.listar(busca?.trim() || undefined, inativos === '1');
  }

  @Post()
  async preCadastrar(
    @Body() body: { email?: string; nome?: string; areas?: string[] },
    @UsuarioAtual() autor: UsuarioAutenticado,
  ) {
    return this.service.preCadastrar(body ?? {}, autor);
  }

  @Patch(':id')
  async atualizar(
    @Param('id') id: string,
    @Body() body: { areas?: string[]; ativo?: boolean },
    @UsuarioAtual() autor: UsuarioAutenticado,
  ) {
    assertUuid(id);
    return this.service.atualizar(id, body ?? {}, autor);
  }

  @Delete(':id')
  async removerPreCadastro(
    @Param('id') id: string,
    @UsuarioAtual() autor: UsuarioAutenticado,
  ) {
    assertUuid(id);
    return this.service.removerPreCadastro(id, autor);
  }
}
