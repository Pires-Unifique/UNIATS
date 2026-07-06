import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { z } from 'zod';

import { OffboardingService } from './offboarding.service.js';

const TOKEN_REGEX = /^[0-9a-f]{32,96}$/i;

const ConfirmarSchema = z.object({
  motivo: z.string().min(1, 'Informe o motivo.'),
  cumpre_aviso_previo: z.boolean(),
  aviso_previo_dias: z.number().int().positive().nullish(),
  email_pessoal: z.string().nullish(),
  whatsapp_pessoal: z.string().nullish(),
});

/**
 * Acesso PÚBLICO do colaborador via link com token (SEM AuthGuard) — ele pede o
 * próprio desligamento sem login interno. Protegido por: token aleatório/uso
 * único/validade (ver service) + ThrottlerGuard (rate-limit). Nada acontece sem
 * as assinaturas posteriores.
 */
@Controller('api/offboarding/auto')
@UseGuards(ThrottlerGuard)
// Endpoint PÚBLICO por token: limite mais apertado que o global (defesa extra
// contra sondagem de token, mesmo o token sendo aleatório de 192 bits).
@Throttle({ default: { limit: 20, ttl: 60_000 } })
export class OffboardingAutoController {
  constructor(private readonly service: OffboardingService) {}

  @Get(':token')
  async prefill(@Param('token') token: string) {
    if (!TOKEN_REGEX.test(token)) throw new BadRequestException('Link inválido.');
    return this.service.obterPrefillPorToken(token);
  }

  @Post(':token')
  async confirmar(@Param('token') token: string, @Body() body: unknown) {
    if (!TOKEN_REGEX.test(token)) throw new BadRequestException('Link inválido.');
    const parsed = ConfirmarSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? 'Dados inválidos.');
    }
    return this.service.confirmarAutodesligamento(token, parsed.data);
  }
}
