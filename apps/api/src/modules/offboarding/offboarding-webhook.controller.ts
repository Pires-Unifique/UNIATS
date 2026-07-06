import {
  Body,
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';

import { OffboardingService } from './offboarding.service.js';

/** Compara segredos em tempo constante (evita oráculo de timing). */
function segredoConfere(recebido: string | undefined, esperado: string): boolean {
  if (!recebido) return false;
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

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
    if (!esperado) {
      // Fail-closed: dispara ação de RH (desligamento) — sem segredo em
      // produção, recusa. Em dev, aceita para facilitar testes.
      if (this.config.get<string>('NODE_ENV') === 'production') {
        throw new ServiceUnavailableException(
          'Webhook de offboarding desabilitado: segredo do Autentique ausente em produção.',
        );
      }
    } else if (!segredoConfere(secret, esperado)) {
      throw new ForbiddenException('Assinatura do webhook inválida.');
    }
    return this.service.processarWebhookAutentique(body ?? {});
  }
}
