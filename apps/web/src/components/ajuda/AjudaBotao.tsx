'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { artigoDaRota } from '@/lib/ajuda/indice';

/**
 * “?” ao lado do título da tela — abre o artigo de ajuda DAQUELA tela.
 *
 * O artigo é descoberto pela rota atual (ver `artigoDaRota`), então nenhuma
 * página precisa declarar nada: basta o artigo listar a rota em `rotas`. Tela
 * sem artigo simplesmente não mostra o botão.
 */
export function AjudaBotao() {
  const path = usePathname();
  const artigo = artigoDaRota(path);
  if (!artigo) return null;

  return (
    <Link
      href={`/ajuda/${artigo.slug}` as Route}
      title={`Ajuda: ${artigo.titulo}`}
      aria-label={`Ajuda sobre esta tela: ${artigo.titulo}`}
      className="grid h-5 w-5 shrink-0 place-items-center rounded-full border border-grafite-300 text-xs font-semibold leading-none text-grafite-400 transition-colors hover:border-unifique-500 hover:text-unifique-700 dark:hover:text-unifique-400"
    >
      ?
    </Link>
  );
}
