'use client';

import type { Route } from 'next';
import Link from 'next/link';
import clsx from 'clsx';

import type { Bloco, TomNota } from '@/lib/ajuda/indice';

// Marcação inline aceita nos textos dos artigos. Um só regex com grupo de
// captura: no split, os trechos marcados caem nos índices ÍMPARES.
const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
const LINK = /^\[([^\]]+)\]\(([^)]+)\)$/;

/** Renderiza **negrito**, `código` e [rótulo](/rota) dentro de um texto. */
export function Inline({ texto }: { texto: string }) {
  const partes = texto.split(INLINE);
  return (
    <>
      {partes.map((parte, i) => {
        if (i % 2 === 0) return parte;

        if (parte.startsWith('**')) {
          return (
            <strong key={i} className="font-semibold text-grafite-900">
              {parte.slice(2, -2)}
            </strong>
          );
        }
        if (parte.startsWith('`')) {
          return (
            <code
              key={i}
              className="rounded bg-grafite-100 px-1 py-0.5 text-[0.85em] text-grafite-700"
            >
              {parte.slice(1, -1)}
            </code>
          );
        }
        const m = LINK.exec(parte);
        if (!m) return parte;
        const [, rotulo, destino] = m;
        // Rota interna (começa com "/") vira navegação client-side; o resto
        // seria link externo — hoje não usamos nenhum, mas o fallback evita
        // que um artigo com http:// quebre a página.
        return destino.startsWith('/') ? (
          <Link
            key={i}
            href={destino as Route}
            className="text-unifique-700 underline underline-offset-2 hover:text-unifique-800 dark:text-unifique-400"
          >
            {rotulo}
          </Link>
        ) : (
          <a
            key={i}
            href={destino}
            target="_blank"
            rel="noreferrer"
            className="text-unifique-700 underline underline-offset-2 dark:text-unifique-400"
          >
            {rotulo}
          </a>
        );
      })}
    </>
  );
}

const NOTA_ESTILO: Record<TomNota, { caixa: string; icone: string; rotulo: string }> =
  {
    info: {
      caixa:
        'border-sky-200 bg-sky-50 dark:border-sky-500/30 dark:bg-sky-500/10',
      icone: '💡',
      rotulo: 'Dica',
    },
    atencao: {
      caixa:
        'border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10',
      icone: '⚠️',
      rotulo: 'Atenção',
    },
    lgpd: {
      caixa:
        'border-emerald-200 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10',
      icone: '🔒',
      rotulo: 'LGPD',
    },
  };

/** Renderiza os blocos de um artigo. */
export function Blocos({ blocos }: { blocos: Bloco[] }) {
  return (
    <div className="space-y-4">
      {blocos.map((b, i) => {
        switch (b.tipo) {
          case 'titulo':
            return (
              <h2
                key={i}
                className="pt-3 text-base font-semibold text-grafite-900"
              >
                {b.texto}
              </h2>
            );

          case 'p':
            return (
              <p key={i} className="text-sm leading-relaxed text-grafite-700">
                <Inline texto={b.texto} />
              </p>
            );

          case 'lista':
            return (
              <ul key={i} className="space-y-1.5">
                {b.itens.map((item, j) => (
                  <li
                    key={j}
                    className="flex gap-2 text-sm leading-relaxed text-grafite-700"
                  >
                    <span aria-hidden className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-grafite-400" />
                    <span>
                      <Inline texto={item} />
                    </span>
                  </li>
                ))}
              </ul>
            );

          case 'passos':
            return (
              <ol key={i} className="space-y-2.5">
                {b.itens.map((item, j) => (
                  <li key={j} className="flex gap-3">
                    <span
                      aria-hidden
                      className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-unifique-100 text-[11px] font-semibold tabular-nums text-unifique-700 dark:bg-unifique-500/20 dark:text-unifique-300"
                    >
                      {j + 1}
                    </span>
                    <span className="text-sm leading-relaxed text-grafite-700">
                      <Inline texto={item} />
                    </span>
                  </li>
                ))}
              </ol>
            );

          case 'nota': {
            const estilo = NOTA_ESTILO[b.tom];
            return (
              <div
                key={i}
                className={clsx('flex gap-3 rounded-lg border p-3', estilo.caixa)}
              >
                <span aria-hidden className="text-base leading-none">
                  {estilo.icone}
                </span>
                <div className="min-w-0">
                  <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-grafite-500">
                    {estilo.rotulo}
                  </p>
                  <p className="text-sm leading-relaxed text-grafite-700">
                    <Inline texto={b.texto} />
                  </p>
                </div>
              </div>
            );
          }

          case 'tabela':
            return (
              // Tabela rola dentro do próprio bloco: em tela estreita a página
              // não ganha barra horizontal.
              <div
                key={i}
                className="overflow-x-auto rounded-lg border border-grafite-100"
              >
                <table className="w-full min-w-[28rem] text-sm">
                  <thead className="bg-grafite-50 text-grafite-600">
                    <tr>
                      {b.colunas.map((c) => (
                        <th
                          key={c}
                          className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide"
                        >
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.linhas.map((linha, j) => (
                      <tr key={j} className="border-t border-grafite-100">
                        {linha.map((celula, k) => (
                          <td
                            key={k}
                            className={clsx(
                              'px-3 py-2 align-top leading-relaxed',
                              k === 0
                                ? 'font-medium text-grafite-900'
                                : 'text-grafite-700',
                            )}
                          >
                            <Inline texto={celula} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
        }
      })}
    </div>
  );
}
