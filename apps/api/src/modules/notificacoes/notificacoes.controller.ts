import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

import { AuthGuard } from '../auth/auth.guard.js';
import type { UsuarioAutenticado } from '../auth/auth.types.js';
import { UsuarioAtual } from '../auth/usuario-atual.decorator.js';
import { NotificacoesService } from './notificacoes.service.js';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Notificações internas do usuário logado. Sem `@Areas`: qualquer usuário
 * autenticado vê/gerencia AS SUAS notificações (o escopo é sempre `usuario.id`
 * do token — nunca um id vindo do cliente).
 */
@Controller('api/notificacoes')
@UseGuards(ThrottlerGuard, AuthGuard)
export class NotificacoesController {
  constructor(private readonly service: NotificacoesService) {}

  @Get()
  async listar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Query('apenasNaoLidas') apenasNaoLidas?: string,
    @Query('limite') limite?: string,
  ) {
    const n = limite ? Number(limite) : undefined;
    return this.service.listar(usuario.id, {
      apenasNaoLidas: apenasNaoLidas === 'true',
      limite: Number.isFinite(n) ? n : undefined,
    });
  }

  @Get('contagem')
  async contagem(@UsuarioAtual() usuario: UsuarioAutenticado) {
    return { naoLidas: await this.service.contarNaoLidas(usuario.id) };
  }

  @Patch(':id/lida')
  @HttpCode(204)
  async marcarLida(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('id') id: string,
  ): Promise<void> {
    if (!UUID_REGEX.test(id)) {
      throw new BadRequestException('id inválido.');
    }
    await this.service.marcarLida(usuario.id, id);
  }

  @Post('marcar-todas-lidas')
  async marcarTodasLidas(@UsuarioAtual() usuario: UsuarioAutenticado) {
    return { atualizadas: await this.service.marcarTodasLidas(usuario.id) };
  }
}
