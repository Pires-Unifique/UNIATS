'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';

import { loginLocalAtivo, useAuth } from '@/lib/auth';
import { authEnabled } from '@/lib/msal';

function LoginInner() {
  const params = useSearchParams();
  const expired = params?.get('expired') === '1';
  const { login, loginLocal, pronto, usuario } = useAuth();
  const [user, setUser] = useState('');
  const [senha, setSenha] = useState('');
  const [erroLocal, setErroLocal] = useState<string | null>(null);
  const [entrando, setEntrando] = useState(false);

  if (pronto && usuario) {
    if (typeof window !== 'undefined') {
      window.location.href = '/vagas';
    }
    return null;
  }

  async function entrarLocal() {
    setErroLocal(null);
    setEntrando(true);
    const ok = await loginLocal(user, senha);
    setEntrando(false);
    if (!ok) {
      setErroLocal('Usuário ou senha inválidos.');
      return;
    }
    if (typeof window !== 'undefined') {
      window.location.href = '/vagas';
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-grafite-50">
      <div className="card max-w-md w-full p-8 mx-4">
        <div className="text-center mb-6">
          <div className="inline-block w-10 h-10 rounded-md bg-unifique-600 mb-3" />
          <h1 className="text-xl font-semibold text-grafite-900">
            UNIATS
          </h1>
          <p className="text-sm text-grafite-400 mt-1">
            Acesso restrito a colaboradores Unifique.
          </p>
        </div>

        {expired && (
          <p className="badge-yellow w-full justify-center mb-4">
            Sua sessão expirou — entre novamente.
          </p>
        )}

        {/* Botão Microsoft só faz sentido com SSO configurado. Em modo só-local
            (login obrigatório sem SSO) ele é ocultado para não conceder acesso. */}
        {(authEnabled() || !loginLocalAtivo()) && (
          <button
            type="button"
            className="btn-primary w-full"
            onClick={() => void login()}
          >
            Entrar com Microsoft
          </button>
        )}

        {loginLocalAtivo() && (
          <>
            <div className="flex items-center gap-3 my-5">
              <div className="h-px bg-grafite-100 flex-1" />
              <span className="text-xs text-grafite-400">ou conta local</span>
              <div className="h-px bg-grafite-100 flex-1" />
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void entrarLocal();
              }}
              className="space-y-3"
            >
              <label className="block">
                <span className="text-xs text-grafite-400">Usuário</span>
                <input
                  className="mt-1 w-full border border-grafite-200 rounded-md px-2 py-1.5 text-sm"
                  value={user}
                  onChange={(e) => setUser(e.target.value)}
                  autoComplete="username"
                />
              </label>
              <label className="block">
                <span className="text-xs text-grafite-400">Senha</span>
                <input
                  type="password"
                  className="mt-1 w-full border border-grafite-200 rounded-md px-2 py-1.5 text-sm"
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  autoComplete="current-password"
                />
              </label>
              {erroLocal && (
                <p className="text-xs text-red-600">{erroLocal}</p>
              )}
              <button
                type="submit"
                className="btn-secondary w-full"
                disabled={entrando || !user || !senha}
              >
                {entrando ? 'Entrando…' : 'Entrar com conta local'}
              </button>
              <p className="text-[11px] text-grafite-400 text-center">
                Conta local é apenas para testes — sem acesso automático à
                agenda (use o popup Microsoft ao buscar horários).
              </p>
            </form>
          </>
        )}

        <p className="text-xs text-grafite-400 text-center mt-4">
          LGPD: ao entrar você concorda em registrar suas ações
          (auditoria Art. 37).
        </p>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginInner />
    </Suspense>
  );
}
