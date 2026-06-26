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
import type { UsuarioAutenticado } from '../auth/auth.types.js';
import { z } from 'zod';

import { Areas } from '../auth/areas.decorator.js';
import { AreasGuard } from '../auth/areas.guard.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { UsuarioAtual } from '../auth/usuario-atual.decorator.js';
import { OffboardingService } from './offboarding.service.js';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertUuid(id: string, campo = 'id'): void {
  if (!UUID_REGEX.test(id)) throw new BadRequestException(`${campo} inválido.`);
}

const GerarSchema = z.object({
  colaborador_id: z.string().uuid().nullish(),
  colaborador_matricula: z.string().min(1),
  colaborador_nome: z.string().min(1),
  expira_em_dias: z.number().int().positive().max(365).nullish(),
});

/**
 * Convites de AUTODESLIGAMENTO (links com token). Geração/gestão restritas ao
 * DHO. Registrado ANTES do OffboardingController no módulo: a rota
 * GET /api/offboarding/convites precisa vir antes da genérica /api/offboarding/:id.
 */
@Controller('api/offboarding/convites')
@UseGuards(ThrottlerGuard, AuthGuard, AreasGuard)
export class ConvitesOffboardingController {
  constructor(private readonly service: OffboardingService) {}

  @Get()
  @Areas('dho')
  async listar() {
    return this.service.listarConvites();
  }

  @Post()
  @Areas('dho')
  async gerar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Body() body: unknown,
  ) {
    const parsed = GerarSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? 'Dados inválidos.');
    }
    return this.service.gerarConvite(parsed.data, {
      id: usuario.id,
      nome: usuario.nome,
      email: usuario.email,
    });
  }

  @Post(':id/cancelar')
  @Areas('dho')
  async cancelar(@Param('id') id: string) {
    assertUuid(id);
    return this.service.cancelarConvite(id);
  }
}
