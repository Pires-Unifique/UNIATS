import {
  BadRequestException,
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

import { Areas } from '../auth/areas.decorator.js';
import { AreasGuard } from '../auth/areas.guard.js';
import { AuthGuard } from '../auth/auth.guard.js';
import type { UsuarioAutenticado } from '../auth/auth.types.js';
import { UsuarioAtual } from '../auth/usuario-atual.decorator.js';
import { RetencaoDadosService } from './retencao-dados.service.js';

/**
 * Direito de eliminação do titular — LGPD Art. 18, VI.
 *
 * Por que não existe um botão "excluir minha conta": o candidato NÃO tem conta
 * no Collab. Ele se cadastra na Gupy, e aqui é um registro espelhado de uso
 * interno. O pedido chega pelo canal do DPO e é executado por um operador, com
 * trilha de quem executou e por quê — que é o equivalente funcional exigido
 * pelo Art. 18 quando o titular não é usuário do sistema.
 *
 * Restrito a 'admin' e 'dho': é irreversível e apaga blob no storage.
 */
@Controller('api/lgpd')
@UseGuards(ThrottlerGuard, AuthGuard, AreasGuard)
@Areas('admin', 'dho')
export class LgpdController {
  constructor(private readonly retencao: RetencaoDadosService) {}

  /**
   * Apaga os dados pessoais do candidato. Idempotente: repetir devolve
   * `categorias: []` sem erro e sem auditoria nova.
   */
  @Post('candidatos/:id/apagar')
  async apagarCandidato(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { motivo?: string },
    @UsuarioAtual() autor: UsuarioAutenticado,
  ): Promise<{ id: string; categorias: string[] }> {
    const motivo = body?.motivo?.trim();
    if (!motivo) {
      // Exigido, não opcional: sem o motivo registrado, a trilha não prova a
      // legitimidade do apagamento numa auditoria.
      throw new BadRequestException(
        'Informe o motivo do apagamento (ex.: pedido do titular, protocolo 123).',
      );
    }

    const { categorias } = await this.retencao.apagarCandidato(id, {
      motivo,
      // Chave de API é acesso de máquina e não tem pessoa por trás.
      autorId: autor.chave_api ? null : autor.id,
    });

    return { id, categorias };
  }
}
