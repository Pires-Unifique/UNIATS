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
 *  0. TRAVA DE PRODUÇÃO: se NODE_ENV=production e AUTH_ENABLED != true, recusa
 *     a requisição (o boot já é barrado em env.validation.ts; isto é redundância
 *     defensiva). Em produção a autenticação real é sempre obrigatória.
 *  1. BYPASS DE TESTE (só fora de produção E com AUTH_ENABLED=false): header
 *     `x-dev-oid` impersona um usuário existente — testar escopo por papel via
 *     curl/Postman sem montar o SSO. Inerte assim que a auth real é ligada.
 *  2. AUTH_ENABLED=true → valida o token de verdade (estratégia 'azure-ad').
 *  3. AUTH_ENABLED=false (dev/local) → injeta o admin de desenvolvimento.
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
    const authLigada = this.config.get<boolean>('AUTH_ENABLED') === true;

    // Defesa em profundidade: a validação de env já recusa o boot nesse estado
    // (env.validation.ts), mas reforçamos aqui — em produção NUNCA caímos no
    // usuário de dev nem aceitamos bypass.
    if (ehProducao && !authLigada) {
      throw new UnauthorizedException(
        'Configuração inválida: autenticação desligada em produção.',
      );
    }

    // BYPASS DE TESTE: o header `x-dev-oid` só é honrado FORA de produção E com a
    // autenticação real DESLIGADA (seu único uso legítimo: testar escopo por papel
    // sem montar o SSO). Com AUTH_ENABLED=true ou em produção, é totalmente inerte.
    const devOid = req.header('x-dev-oid');
    if (!ehProducao && !authLigada && devOid) {
      const usuario = await this.authService.resolverPorOid(devOid);
      if (!usuario) {
        throw new UnauthorizedException(
          'x-dev-oid não corresponde a nenhum usuário.',
        );
      }
      req.user = usuario;
      return true;
    }

    if (authLigada) {
      // Delega ao passport: a AzureStrategy valida o token e popula req.user.
      return (await super.canActivate(context)) as boolean;
    }

    req.user = await this.authService.usuarioDevPadrao();
    return true;
  }
}
