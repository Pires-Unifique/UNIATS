'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';

type Item = { href: Route; label: string; icon: string };

// Interfaces separadas por equipe. O permissionamento (grupo de AD) será
// plugado depois — por ora só organizamos a navegação em duas áreas.
const secoes: Array<{ titulo: string; itens: Item[] }> = [
  {
    titulo: 'Recrutamento',
    itens: [
      { href: '/vagas' as Route, label: 'Vagas', icon: '📋' },
      { href: '/vagas/publicar' as Route, label: 'Publicar vaga', icon: '➕' },
      { href: '/entrevistas' as Route, label: 'Entrevistas', icon: '🎙️' },
      { href: '/analise' as Route, label: 'Análise', icon: '📊' },
      { href: '/configuracoes/templates' as Route, label: 'Templates', icon: '✉️' },
    ],
  },
  {
    titulo: 'Admissão',
    itens: [
      { href: '/admissao' as Route, label: 'Admissões', icon: '🧾' },
    ],
  },
];

export function Sidebar() {
  const path = usePathname();

  return (
    <aside className="w-56 shrink-0 border-r border-grafite-100 bg-white">
      <div className="p-4 border-b border-grafite-100">
        <Link
          href="/vagas"
          className="text-lg font-semibold text-grafite-900 flex items-center gap-2"
        >
          <span className="inline-block w-2 h-2 rounded-full bg-unifique-600" />
          UNIATS
        </Link>
        <p className="text-xs text-grafite-400 mt-0.5">Unifique RH</p>
      </div>

      <nav className="p-2 space-y-4">
        {secoes.map((secao) => (
          <div key={secao.titulo}>
            <p className="px-3 pt-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-grafite-400">
              {secao.titulo}
            </p>
            <div className="space-y-0.5">
              {secao.itens.map((l) => {
                const active = path?.startsWith(l.href);
                return (
                  <Link
                    key={l.href}
                    href={l.href}
                    className={clsx(
                      'flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors',
                      active
                        ? 'bg-unifique-50 text-unifique-700 font-medium dark:bg-unifique-500/15 dark:text-unifique-400'
                        : 'text-grafite-600 hover:bg-grafite-100',
                    )}
                  >
                    <span aria-hidden>{l.icon}</span>
                    {l.label}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  );
}
