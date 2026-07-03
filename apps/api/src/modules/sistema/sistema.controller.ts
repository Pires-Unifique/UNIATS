import { Body, Controller, Delete, Get, Post, Put, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

import { Areas } from '../auth/areas.decorator.js';
import { AreasGuard } from '../auth/areas.guard.js';
import { AuthGuard } from '../auth/auth.guard.js';
import type { UsuarioAutenticado } from '../auth/auth.types.js';
import { UsuarioAtual } from '../auth/usuario-atual.decorator.js';
import { WhatsappPacerService } from '../messaging/whatsapp-pacer.service.js';
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
  constructor(
    private readonly service: SistemaService,
    private readonly pacer: WhatsappPacerService,
  ) {}

  @Get('waha/status')
  async statusWaha() {
    return this.service.statusWaha();
  }

  /** Config do pacing anti-banimento — efetiva (env como padrão + override). */
  @Get('waha/config')
  async configWaha() {
    return this.pacer.obterConfig();
  }

  @Put('waha/config')
  async atualizarConfigWaha(
    @Body()
    body: {
      pacing?: boolean;
      cap_diario?: number;
      janela_inicio?: number;
      janela_fim?: number;
      janela_dias?: number[];
      jitter_min_ms?: number;
      jitter_max_ms?: number;
      salvar_contato?: boolean;
    },
    @UsuarioAtual() autor: UsuarioAutenticado,
  ) {
    return this.pacer.atualizarConfig(body ?? {}, autor);
  }

  /** Remove o override — volta ao padrão do ambiente (envs WHATSAPP_*). */
  @Delete('waha/config')
  async restaurarConfigWaha(@UsuarioAtual() autor: UsuarioAutenticado) {
    return this.pacer.restaurarPadrao(autor);
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
