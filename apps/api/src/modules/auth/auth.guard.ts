import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard as PassportAuthGuard } from '@nestjs/passport';
import type { Request } from 'express';

import { AuthService } from './auth.service.js';

/**
 * Guard de autenticação com três caminhos, nesta ordem de precedência:
 *
 *  1. BYPASS DE TESTE (nunca em produção): header `x-dev-oid` impersona um
 *     usuário existente — permite testar o escopo por papel via curl/Postman
 *     sem montar o SSO. Gated por NODE_ENV !== 'production'.
 *  2. AUTH_ENABLED=true → valida o token de verdade (estratégia 'azure-ad').
 *  3. AUTH_ENABLED=false (dev/local) → injeta o admin de desenvolvimento.
 *     É por isso que ligar este guard HOJE não muda nada no seu fluxo.
 */
@Injectable()
export class AuthGuard extends PassportAuthGuard('azure-ad') {
  constructor(
    private readonly config: ConfigService,
    private readonly authService: AuthService,
  ) {
    super();
  }

  override async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const ehProducao = this.config.get<string>('NODE_ENV') === 'production';

    const devOid = req.header('x-dev-oid');
    if (!ehProducao && devOid) {
      const usuario = await this.authService.resolverPorOid(devOid);
      if (!usuario) {
        throw new UnauthorizedException(
          'x-dev-oid não corresponde a nenhum usuário.',
        );
      }
      req.user = usuario;
      return true;
    }

    if (this.config.get<boolean>('AUTH_ENABLED')) {
      // Delega ao passport: a AzureStrategy valida o token e popula req.user.
      return (await super.canActivate(context)) as boolean;
    }

    req.user = await this.authService.usuarioDevPadrao();
    return true;
  }
}
