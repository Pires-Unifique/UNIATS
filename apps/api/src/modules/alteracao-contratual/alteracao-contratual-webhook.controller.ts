import {
  Body,
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  Post,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AlteracaoContratualService } from './alteracao-contratual.service.js';

/**
 * Callback do AUTENTIQUE (assinou/recusou). SEM AuthGuard — é chamada externa.
 * Protegido por segredo compartilhado (AUTENTIQUE_WEBHOOK_SECRET) no header
 * `x-autentique-secret`. Sem segredo configurado, aceita (dev).
 *
 * NB: o shape real do payload do Autentique deve ser mapeado aqui quando a
 * integração for ligada — hoje aceitamos o shape interno {documentoId, ...}.
 */
@Controller('api/webhooks/autentique')
export class AlteracaoContratualWebhookController {
  constructor(
    private readonly service: AlteracaoContratualService,
    private readonly config: ConfigService,
  ) {}

  @Post()
  @HttpCode(200)
  async receber(
    @Headers('x-autentique-secret') secret: string | undefined,
    @Body() body: { documentoId?: string; signatarioId?: string; evento?: string },
  ) {
    const esperado = this.config.get<string>('AUTENTIQUE_WEBHOOK_SECRET');
    if (esperado && secret !== esperado) {
      throw new ForbiddenException('Assinatura do webhook inválida.');
    }
    return this.service.processarWebhookAutentique(body ?? {});
  }
}
