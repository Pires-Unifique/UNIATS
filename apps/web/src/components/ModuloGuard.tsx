'use client';

import type { Route } from 'next';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { rotaDeModuloOculto } from '@/lib/modulos';

/**
 * Impede a navegação para módulos desligados nesta fase (ver lib/modulos.ts).
 * A sidebar já não mostra os links; isto cobre URL digitada, link salvo e
 * histórico do navegador. Não é controle de segurança — a autorização real
 * continua nos guards da API (`@Areas`); aqui é para a equipe não cair numa
 * tela que ainda não deve usar.
 */
export function ModuloGuard() {
  const path = usePathname();
  const router = useRouter();
  const bloqueado = rotaDeModuloOculto(path);

  useEffect(() => {
    if (bloqueado) router.replace('/inicio' as Route);
  }, [bloqueado, router]);

  return null;
}
