import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { BearerStrategy, type ITokenPayload } from 'passport-azure-ad';

import { AuthService } from './auth.service.js';
import type { UsuarioAutenticado } from './auth.types.js';

/**
 * Valida o token do Entra (Azure AD) usando a lib oficial da Microsoft.
 * A BearerStrategy busca o JWKS do tenant e confere assinatura, `iss` e `aud`
 * automaticamente. Só é EXERCIDA quando o AuthGuard delega (AUTH_ENABLED=true);
 * em dev/local o guard usa o bypass e a estratégia nunca é chamada.
 *
 * MODELO DE TOKEN: o front envia o ID TOKEN (cujo `aud` = client id do app),
 * pois NÃO expomos uma API própria no Entra (sem Application ID URI/scope). Por
 * isso `clientId` PRECISA estar na lista de `audience` abaixo — não remova. Se um
 * dia expor a API e migrar para access token de escopo próprio, aí sim adicione
 * o App ID URI ao `audience`. A validação de assinatura/iss/exp é idêntica.
 */
@Injectable()
export class AzureStrategy extends PassportStrategy(BearerStrategy, 'azure-ad') {
  private readonly logger = new Logger(AzureStrategy.name);
  private readonly dominiosPermitidos: string[];

  constructor(
    config: ConfigService,
    private readonly authService: AuthService,
  ) {
    // Fallbacks seguros para que o construtor nunca quebre quando o SSO não
    // está configurado (dev): a estratégia só é usada de fato com AUTH_ENABLED.
    const tenant = config.get<string>('AZURE_AD_TENANT_ID') ?? 'common';
    const clientId =
      config.get<string>('AZURE_AD_CLIENT_ID') ??
      '00000000-0000-0000-0000-000000000000';
    const audience =
      config.get<string>('AZURE_AD_AUDIENCE') ?? 'api://uniats-api';

    super({
      identityMetadata: `https://login.microsoftonline.com/${tenant}/v2.0/.well-known/openid-configuration`,
      clientID: clientId,
      // O ID token traz `aud` = clientID; um eventual access token de API custom
      // traria `aud` = App ID URI. Aceitamos os dois — o clientID é o que vale hoje.
      audience: [audience, clientId],
      validateIssuer: true,
      passReqToCallback: false,
      loggingLevel: 'warn',
      loggingNoPII: true,
    });

    this.dominiosPermitidos = (
      config.get<string>('AZURE_AD_ALLOWED_DOMAIN') ?? 'unifique.com.br'
    )
      .split(',')
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean);
  }

  /** Chamada pelo passport após a validação criptográfica do token. */
  async validate(payload: ITokenPayload): Promise<UsuarioAutenticado> {
    const azureOid = payload.oid ?? payload.sub;
    const email = (
      payload.preferred_username ??
      payload.upn ??
      payload.email ??
      payload.unique_name ??
      ''
    ).toLowerCase();
    const nome = payload.name ?? email;

    if (!azureOid) {
      throw new UnauthorizedException('Token sem claim `oid`.');
    }
    const dominioOk = this.dominiosPermitidos.some((d) =>
      email.endsWith(`@${d}`),
    );
    if (!dominioOk) {
      this.logger.warn(`Login bloqueado: domínio não permitido (${email}).`);
      throw new UnauthorizedException('Domínio de e-mail não autorizado.');
    }

    const usuario = await this.authService.provisionarUsuario({
      azure_oid: azureOid,
      email,
      nome,
    });
    if (!usuario.ativo) {
      throw new UnauthorizedException('Usuário inativo.');
    }
    return usuario;
  }
}
