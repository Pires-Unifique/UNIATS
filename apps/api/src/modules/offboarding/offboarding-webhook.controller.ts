import {
  Body,
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  Post,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { OffboardingService } from './offboarding.service.js';

/**
 * Callback do AUTENTIQUE (assinou/recusou) para o TERMO de offboarding. SEM
 * AuthGuard — chamada externa. Protegido por segredo compartilhado
 * (AUTENTIQUE_OFFBOARDING_WEBHOOK_SECRET, com fallback p/ AUTENTIQUE_WEBHOOK_SECRET)
 * no header `x-autentique-secret`. Sem segredo configurado, aceita (dev).
 *
 * NB: o shape real do payload do Autentique deve ser mapeado aqui quando a
 * integração for ligada — hoje aceitamos o shape interno {documentoId, ...}.
 */
@Controller('api/webhooks/autentique-offboarding')
export class OffboardingWebhookController {
  constructor(
    private readonly service: OffboardingService,
    private readonly config: ConfigService,
  ) {}

  @Post()
  @HttpCode(200)
  async receber(
    @Headers('x-autentique-secret') secret: string | undefined,
    @Body() body: { documentoId?: string; signatarioId?: string; evento?: string },
  ) {
    const esperado =
      this.config.get<string>('AUTENTIQUE_OFFBOARDING_WEBHOOK_SECRET') ??
      this.config.get<string>('AUTENTIQUE_WEBHOOK_SECRET');
    if (esperado && secret !== esperado) {
      throw new ForbiddenException('Assinatura do webhook inválida.');
    }
    return this.service.processarWebhookAutentique(body ?? {});
  }
}
