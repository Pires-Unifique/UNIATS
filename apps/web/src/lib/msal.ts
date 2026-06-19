import {
  Configuration,
  PublicClientApplication,
} from '@azure/msal-browser';

const clientId = process.env.NEXT_PUBLIC_AZURE_AD_CLIENT_ID ?? '';
const tenantId = process.env.NEXT_PUBLIC_AZURE_AD_TENANT_ID ?? 'common';
// NB: NÃO usamos mais um scope de API própria (api://.../user_impersonation).
// A API valida o ID TOKEN (aud = client id), então o login pede só escopos OIDC
// e não depende de "Expose an API"/Application ID URI no Entra. O token enviado
// à API é o r.idToken (ver auth.tsx). O Graph da agenda tem request próprio abaixo.

export const msalConfig: Configuration = {
  auth: {
    clientId,
    authority: `https://login.microsoftonline.com/${tenantId}`,
    redirectUri:
      typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000',
  },
  cache: {
    cacheLocation: 'sessionStorage', // não expõe token em localStorage (CSP-friendly)
    storeAuthStateInCookie: false,
  },
};

export const loginRequest = {
  scopes: ['openid', 'profile', 'email'],
};

// Aquisição silenciosa só para renovar a sessão; lemos o r.idToken do resultado.
export const apiTokenRequest = {
  scopes: ['openid', 'profile', 'email'],
};

/**
 * Escopo delegado para ler a agenda do recrutador (Microsoft Graph).
 * Usado no fluxo "sob demanda" (popup) ao conectar a agenda — independente do
 * login geral do app.
 */
export const graphCalendarRequest = {
  scopes: ['User.Read', 'Calendars.Read'],
};

/**
 * Singleton lazy. Instanciamos no client somente porque `window` é exigido.
 */
let _instance: PublicClientApplication | null = null;

export function getMsal(): PublicClientApplication {
  if (typeof window === 'undefined') {
    throw new Error('MSAL só pode ser instanciado no cliente.');
  }
  if (!_instance) {
    if (!clientId) {
      // Em dev sem MSAL configurado, ainda funcionamos com auth disabled.
      // O AuthProvider trata esse caso.
      _instance = new PublicClientApplication(msalConfig);
    } else {
      _instance = new PublicClientApplication(msalConfig);
    }
  }
  return _instance;
}

/**
 * SSO do APP (login obrigatório em todas as páginas) é separado do acesso à
 * agenda (Graph). Só definir o Client ID NÃO força login: o app segue em modo
 * "dev sem login" e o Microsoft aparece apenas no popup sob demanda da agenda.
 * Para exigir login no app inteiro, defina NEXT_PUBLIC_AZURE_AD_SSO=true.
 */
const ssoAtivado = process.env.NEXT_PUBLIC_AZURE_AD_SSO === 'true';

export function authEnabled(): boolean {
  return Boolean(clientId) && ssoAtivado;
}
