'use client';

import { useAuth } from '@/lib/auth';

export function Header() {
  const { usuario, logout } = useAuth();

  return (
    <header className="h-14 bg-white border-b border-grafite-100 flex items-center justify-between px-6">
      <div className="text-sm text-grafite-400">
        UNIATS — Triagem e Análise de Entrevistas
      </div>
      <div className="flex items-center gap-3">
        {usuario ? (
          <>
            <div className="text-sm text-grafite-600">
              {usuario.nome}{' '}
              <span className="text-grafite-400">({usuario.email})</span>
            </div>
            <button
              type="button"
              className="btn-ghost text-xs"
              onClick={logout}
            >
              Sair
            </button>
          </>
        ) : (
          <span className="text-sm text-grafite-400">Não autenticado</span>
        )}
      </div>
    </header>
  );
}
