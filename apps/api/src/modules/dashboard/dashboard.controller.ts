import { Controller, Get, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

import { AuthGuard } from '../auth/auth.guard.js';
import type { UsuarioAutenticado } from '../auth/auth.types.js';
import { UsuarioAtual } from '../auth/usuario-atual.decorator.js';
import { DashboardService } from './dashboard.service.js';

/**
 * Tela de Início — indicadores do dia ESCOPADOS ao usuário logado. Aberto a
 * qualquer autenticado (sem AreasGuard): o service resolve o escopo — gestor
 * vê só as próprias vagas; recrutamento/admin veem as vagas em que são o
 * recrutador (com fallback global quando não têm nenhuma).
 */
@Controller('api/dashboard')
@UseGuards(ThrottlerGuard, AuthGuard)
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  @Get()
  async resumo(@UsuarioAtual() usuario: UsuarioAutenticado) {
    return this.service.resumo(usuario);
  }
}
