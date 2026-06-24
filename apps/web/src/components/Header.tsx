'use client';

import { usePathname } from 'next/navigation';

import { useAuth } from '@/lib/auth';
import { useTheme } from '@/lib/theme';

// Chamada do header por módulo — cada área do sistema mostra seu próprio texto.
// O primeiro prefixo que casar com a rota atual vence; edite/estenda aqui ao
// adicionar módulos novos.
const TITULOS_MODULO: Array<{ prefixos: string[]; texto: string }> = [
  {
    prefixos: ['/admissao'],
    texto: 'Collab — Admissão Digital',
  },
  {
    // Recrutamento: vagas, agenda, análise, templates e ficha de candidatura.
    prefixos: ['/vagas', '/entrevistas', '/analise', '/configuracoes', '/candidaturas'],
    texto: 'Collab — Triagem e Análise de Entrevistas',
  },
];

function tituloModulo(path: string | null): string {
  if (!path) return 'Collab';
  const modulo = TITULOS_MODULO.find((m) =>
    m.prefixos.some((p) => path.startsWith(p)),
  );
  return modulo?.texto ?? 'Collab';
}

export function Header() {
  const { usuario, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const path = usePathname();

  return (
    <header className="h-14 bg-white border-b border-grafite-100 flex items-center justify-between px-6">
      <div className="text-sm text-grafite-400">{tituloModulo(path)}</div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={toggle}
          className="btn-ghost text-base px-2 py-1"
          title={theme === 'dark' ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
          aria-label={theme === 'dark' ? 'Ativar tema claro' : 'Ativar tema escuro'}
        >
          <span aria-hidden>{theme === 'dark' ? '☀️' : '🌙'}</span>
        </button>
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
