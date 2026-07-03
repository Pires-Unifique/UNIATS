import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

import { Areas } from '../auth/areas.decorator.js';
import { AreasGuard } from '../auth/areas.guard.js';
import { AuthGuard } from '../auth/auth.guard.js';
import type { UsuarioAutenticado } from '../auth/auth.types.js';
import { UsuarioAtual } from '../auth/usuario-atual.decorator.js';
import { SistemaService } from './sistema.service.js';

/**
 * Tela WhatsApp da seção Sistema — status/QR/restart da sessão WAHA, proxiados
 * pela API (a WAHA_API_KEY nunca chega ao navegador; o WAHA segue em loopback).
 * Restrito a 'admin'.
 */
@Controller('api/sistema')
@UseGuards(ThrottlerGuard, AuthGuard, AreasGuard)
@Areas('admin')
export class SistemaController {
  constructor(private readonly service: SistemaService) {}

  @Get('waha/status')
  async statusWaha() {
    return this.service.statusWaha();
  }

  @Get('waha/qr')
  async qrWaha() {
    return this.service.qrWaha();
  }

  @Post('waha/restart')
  async reiniciarWaha(@UsuarioAtual() autor: UsuarioAutenticado) {
    return this.service.reiniciarWaha(autor);
  }
}
