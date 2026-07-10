'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';

import { type Area, useAuth } from '../lib/auth';
import { Logo } from './Logo';

// `areas`: área(s) que liberam o item. `undefined` = qualquer usuário
// autenticado (a própria API escopa os dados — ex.: o gestor só vê a vaga dele
// em "Vagas"/"Agenda"). 'admin' enxerga tudo (tratado no filtro).
type Item = { href: Route; label: string; icon: string; areas?: Area[] };

const secoes: Array<{ titulo: string; areas?: Area[]; itens: Item[] }> = [
  {
    titulo: 'Recrutamento',
    itens: [
      // Vagas e Agenda: visíveis a todos — o gestor vê só as vagas dele (a API escopa).
      { href: '/vagas' as Route, label: 'Vagas', icon: '📋' },
      { href: '/entrevistas' as Route, label: 'Agenda', icon: '🗓️' },
      // Ações globais de recrutamento: só quem tem a área 'recrutamento'.
      { href: '/cargos' as Route, label: 'Cargos', icon: '🏷️', areas: ['recrutamento'] },
      { href: '/vagas/publicar' as Route, label: 'Publicar vaga', icon: '➕', areas: ['recrutamento'] },
      { href: '/analise' as Route, label: 'Análise', icon: '📊', areas: ['recrutamento'] },
      { href: '/configuracoes/templates' as Route, label: 'Templates', icon: '✉️', areas: ['recrutamento'] },
      // Banco de perguntas padrão: gestão compartilhada entre recrutamento e DHO.
      { href: '/configuracoes/perguntas' as Route, label: 'Perguntas padrão', icon: '❓', areas: ['recrutamento', 'dho'] },
    ],
  },
  {
    titulo: 'Admissão',
    areas: ['admissao'],
    itens: [
      { href: '/admissao' as Route, label: 'Admissões', icon: '🧾', areas: ['admissao'] },
    ],
  },
  {
    // Sem `areas`: o módulo é do LÍDER (que vê todos os colaboradores) — o acesso
    // será escopado pela detecção de liderança na API, como Vagas/Agenda. A fila
    // de aprovações do DHO (área 'dho') entra como item próprio quando plugarmos.
    titulo: 'Administração de Pessoas',
    itens: [
      { href: '/alteracao-contratual' as Route, label: 'Alteração contratual', icon: '📝' },
      { href: '/offboarding' as Route, label: 'Offboarding', icon: '👋' },
      { href: '/offboarding/procuradores' as Route, label: 'Procuradores', icon: '🖊️', areas: ['dho'] },
    ],
  },
  {
    // Operação do Collab. Usuários também abre para 'gestao_acessos' (o papel
    // dedicado a liberar acessos); WhatsApp/Chaves de API seguem só admin
    // ('admin' passa no filtro de qualquer item).
    titulo: 'Sistema',
    itens: [
      { href: '/configuracoes/usuarios' as Route, label: 'Usuários', icon: '👥', areas: ['gestao_acessos'] },
      { href: '/configuracoes/whatsapp' as Route, label: 'WhatsApp', icon: '💬', areas: ['admin'] },
      { href: '/configuracoes/chaves-api' as Route, label: 'Chaves de API', icon: '🔑', areas: ['admin'] },
    ],
  },
];

/**
 * Item visível se não exige área, ou se o usuário tem 'admin' ou a área exigida.
 * Exceção: para quem SÓ tem 'gestao_acessos', os itens sem área (Vagas, Agenda,
 * Alteração contratual…) somem — essa pessoa administra acessos e não participa
 * dos processos (a API já não entregaria dados; aqui é para o menu não poluir).
 */
function podeVer(
  itemAreas: Area[] | undefined,
  areas: Area[],
  apenasGestaoAcessos: boolean,
): boolean {
  if (!itemAreas || itemAreas.length === 0) return !apenasGestaoAcessos;
  if (areas.includes('admin')) return true;
  return itemAreas.some((a) => areas.includes(a));
}

export function Sidebar() {
  const path = usePathname();
  const { areas, apenasGestaoAcessos } = useAuth();

  const secoesVisiveis = secoes
    .map((secao) => ({
      ...secao,
      itens: secao.itens.filter((it) =>
        podeVer(it.areas, areas, apenasGestaoAcessos),
      ),
    }))
    .filter((secao) => secao.itens.length > 0);

  return (
    <aside className="w-56 shrink-0 border-r border-grafite-100 bg-white">
      <div className="p-4 border-b border-grafite-100">
        <Link
          href="/vagas"
          className="text-lg font-semibold text-grafite-900 flex items-center gap-2"
        >
          <Logo size={26} />
          Collab
        </Link>
        <p className="text-xs text-grafite-400 mt-0.5">Unifique RH</p>
      </div>

      <nav className="p-2 space-y-4">
        {secoesVisiveis.map((secao) => (
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
