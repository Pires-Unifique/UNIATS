// Tipos mínimos para `passport-azure-ad` (a lib não publica .d.ts próprios nem há
// @types disponível). Cobrimos apenas a BearerStrategy, que é o que usamos para
// validar o access token do Entra (Azure AD) na API.
declare module 'passport-azure-ad' {
  import type { Request } from 'express';

  export interface IBearerStrategyOption {
    /** URL do documento OpenID Connect do tenant (.well-known/openid-configuration). */
    identityMetadata: string;
    /** Application (client) ID do App Registration da API. */
    clientID: string;
    /** `aud` aceito(s). Token de API custom traz o App ID URI ou o clientID. */
    audience?: string | string[];
    /** Valida o `iss` contra o tenant configurado. */
    validateIssuer?: boolean;
    issuer?: string | string[];
    /** Quando true, o verify recebe (req, token, done). Usamos false. */
    passReqToCallback?: false;
    loggingLevel?: 'info' | 'warn' | 'error';
    /** Não loga dados pessoais do token (LGPD). */
    loggingNoPII?: boolean;
    scope?: string[];
    clockSkew?: number;
  }

  /** Subconjunto das claims que lemos do access token do Entra. */
  export interface ITokenPayload {
    oid?: string;
    sub?: string;
    preferred_username?: string;
    upn?: string;
    email?: string;
    unique_name?: string;
    name?: string;
    tid?: string;
    roles?: string[];
    [claim: string]: unknown;
  }

  export type VerifyCallback = (
    err: Error | null,
    user?: unknown,
    info?: unknown,
  ) => void;

  export class BearerStrategy {
    constructor(
      options: IBearerStrategyOption,
      verify: (token: ITokenPayload, done: VerifyCallback) => void,
    );
    name: string;
    authenticate(req: Request, options?: unknown): void;
  }
}
