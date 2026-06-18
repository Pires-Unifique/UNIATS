import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

import { AuthGuard } from '../auth/auth.guard.js';
import { AuthService } from '../auth/auth.service.js';
import type { UsuarioAutenticado } from '../auth/auth.types.js';
import { UsuarioAtual } from '../auth/usuario-atual.decorator.js';
import { CurriculoService } from './curriculo.service.js';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Endpoints REST para inspeção e reprocessamento de currículos. Escopado por
 * posse da vaga: o gestor acessa só os CVs dos candidatos das vagas dele.
 */
@Controller('api/curriculos')
@UseGuards(ThrottlerGuard, AuthGuard)
export class CurriculoController {
  constructor(
    private readonly service: CurriculoService,
    private readonly auth: AuthService,
  ) {}

  @Get(':candidaturaId')
  async obter(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('candidaturaId') candidaturaId: string,
  ) {
    if (!UUID_REGEX.test(candidaturaId)) {
      throw new BadRequestException('candidaturaId deve ser um UUID válido.');
    }
    await this.auth.assertCandidaturaPermitida(usuario, candidaturaId);
    return this.service.buscarPorCandidatura(candidaturaId);
  }

  @Post(':candidaturaId/reprocessar')
  async reprocessar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('candidaturaId') candidaturaId: string,
  ) {
    if (!UUID_REGEX.test(candidaturaId)) {
      throw new BadRequestException('candidaturaId deve ser um UUID válido.');
    }
    await this.auth.assertCandidaturaPermitida(usuario, candidaturaId);
    return this.service.reprocessar(candidaturaId);
  }
}
