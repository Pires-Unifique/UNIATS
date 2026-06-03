'use client';

import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  AccountInfo,
  InteractionRequiredAuthError,
} from '@azure/msal-browser';

import { configurarTokenProvider } from './api';
import { apiTokenRequest, authEnabled, getMsal, loginRequest } from './msal';

interface UsuarioInfo {
  nome: string;
  email: string;
  oid: string;
}

interface AuthCtx {
  pronto: boolean;
  usuario: UsuarioInfo | null;
  login: () => Promise<void>;
  /** Login local (sem SSO) — dev/teste. Retorna false se credenciais inválidas. */
  loginLocal: (usuario: string, senha: string) => Promise<boolean>;
  logout: () => Promise<void>;
}

/**
 * Login local (sem SSO) — APENAS para dev/teste, gated por env.
 * ⚠️ Desligar antes de produção (remover NEXT_PUBLIC_LOGIN_LOCAL do .env).
 */
const LOGIN_LOCAL_ATIVO = process.env.NEXT_PUBLIC_LOGIN_LOCAL === 'true';
const LOCAL_SESSION_KEY = 'triagem.usuario_local';
const USUARIO_LOCAL: UsuarioInfo = {
  nome: 'Admin (local)',
  email: 'admin@unifique.com.br',
  oid: '00000000-0000-0000-0000-000000000001', // mesmo oid do admin do seed
};

export function loginLocalAtivo(): boolean {
  return LOGIN_LOCAL_ATIVO;
}

function lerSessaoLocal(): UsuarioInfo | null {
  if (!LOGIN_LOCAL_ATIVO || typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(LOCAL_SESSION_KEY);
    return raw ? (JSON.parse(raw) as UsuarioInfo) : null;
  } catch {
    return null;
  }
}

const Ctx = createContext<AuthCtx | null>(null);

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error('useAuth deve ser usado dentro de <AuthProvider>.');
  }
  return ctx;
}

/**
 * Provider raiz de auth. Em produção, usa Azure AD (MSAL). Em dev:
 *  - sem `NEXT_PUBLIC_AZURE_AD_CLIENT_ID` → modo "auth desligado" (usuário fake);
 *  - com `NEXT_PUBLIC_LOGIN_LOCAL=true` → formulário local (admin/admin) na
 *    tela de login, coexistindo com o botão "Entrar com Microsoft".
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [pronto, setPronto] = useState(false);
  const [usuario, setUsuario] = useState<UsuarioInfo | null>(null);

  // Inicialização — só no client.
  useEffect(() => {
    // 1) Sessão LOCAL tem precedência (login admin/admin já feito nesta aba).
    const local = lerSessaoLocal();
    if (local) {
      configurarTokenProvider(async () => null);
      setUsuario(local);
      setPronto(true);
      return;
    }

    if (!authEnabled()) {
      // Modo dev sem MSAL: identidade fake.
      configurarTokenProvider(async () => null);
      setUsuario({
        nome: 'Recrutador (dev)',
        email: 'dev@unifique.com.br',
        oid: '00000000-0000-4000-8000-000000000000',
      });
      setPronto(true);
      return;
    }

    const msal = getMsal();
    msal
      .initialize()
      .then(() => msal.handleRedirectPromise())
      .then((res) => {
        const conta =
          res?.account ?? msal.getAllAccounts()[0] ?? null;
        if (conta) {
          aplicarConta(conta);
        }
        configurarTokenProvider(async () => {
          const ativo = msal.getAllAccounts()[0];
          if (!ativo) return null;
          try {
            const r = await msal.acquireTokenSilent({
              ...apiTokenRequest,
              account: ativo,
            });
            return r.accessToken;
          } catch (err) {
            if (err instanceof InteractionRequiredAuthError) {
              await msal.acquireTokenRedirect({
                ...apiTokenRequest,
                account: ativo,
              });
            }
            return null;
          }
        });
        setPronto(true);
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error('Falha ao inicializar MSAL:', err);
        setPronto(true);
      });

    function aplicarConta(conta: AccountInfo) {
      // O Object ID (GUID) do usuário. Preferimos o claim `oid`; no fallback,
      // o `homeAccountId` vem como `<oid>.<tenantId>` — extraímos só o GUID.
      const oid =
        (conta.idTokenClaims?.oid as string | undefined) ??
        conta.homeAccountId.split('.')[0];
      setUsuario({
        nome: conta.name ?? conta.username,
        email: conta.username,
        oid,
      });
    }
  }, []);

  const value = useMemo<AuthCtx>(
    () => ({
      pronto,
      usuario,
      async login() {
        if (!authEnabled()) {
          setUsuario({
            nome: 'Recrutador (dev)',
            email: 'dev@unifique.com.br',
            oid: '00000000-0000-4000-8000-000000000000',
          });
          return;
        }
        await getMsal().loginRedirect(loginRequest);
      },
      async loginLocal(usuarioInput: string, senha: string) {
        if (!LOGIN_LOCAL_ATIVO) return false;
        // Credenciais fixas de dev/teste — NÃO usar em produção.
        if (usuarioInput.trim() !== 'admin' || senha !== 'admin') {
          return false;
        }
        try {
          sessionStorage.setItem(
            LOCAL_SESSION_KEY,
            JSON.stringify(USUARIO_LOCAL),
          );
        } catch {
          /* sessionStorage indisponível — segue só em memória */
        }
        configurarTokenProvider(async () => null);
        setUsuario(USUARIO_LOCAL);
        return true;
      },
      async logout() {
        if (lerSessaoLocal()) {
          try {
            sessionStorage.removeItem(LOCAL_SESSION_KEY);
          } catch {
            /* ignore */
          }
          setUsuario(null);
          if (typeof window !== 'undefined') {
            window.location.href = '/login';
          }
          return;
        }
        if (!authEnabled()) {
          setUsuario(null);
          return;
        }
        await getMsal().logoutRedirect();
      },
    }),
    [pronto, usuario],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * Guard simples — redireciona para /login se não autenticado.
 */
export function AuthGuard({ children }: { children: ReactNode }) {
  const { pronto, usuario } = useAuth();
  useEffect(() => {
    if (pronto && !usuario && typeof window !== 'undefined') {
      window.location.href = '/login';
    }
  }, [pronto, usuario]);

  if (!pronto) {
    return (
      <div className="p-8 text-sm text-grafite-400">Carregando…</div>
    );
  }
  if (!usuario) return null;
  return <>{children}</>;
}
