'use client';

import type { Route } from 'next';
import Link from 'next/link';

import { Blocos } from '@/components/ajuda/Conteudo';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { artigoPorSlug } from '@/lib/ajuda/indice';

export default function ArtigoAjudaPage({
  params,
}: {
  params: { slug: string };
}) {
  const artigo = artigoPorSlug(params.slug);

  if (!artigo) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader
          titulo="Artigo não encontrado"
          acoes={
            <Link href="/ajuda" className="btn-soft">
              ← Ajuda
            </Link>
          }
        />
        <EmptyState
          titulo="Esse artigo não existe (ou mudou de endereço)"
          descricao="Volte ao índice da ajuda e use a busca."
        />
      </div>
    );
  }

  const relacionados = (artigo.relacionados ?? [])
    .map(artigoPorSlug)
    .filter((a): a is NonNullable<typeof a> => Boolean(a));

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        titulo={`${artigo.icone} ${artigo.titulo}`}
        subtitulo={artigo.resumo}
        acoes={
          <Link href="/ajuda" className="btn-soft">
            ← Ajuda
          </Link>
        }
      />

      <article className="card p-6">
        <Blocos blocos={artigo.blocos} />
      </article>

      {relacionados.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-grafite-400">
            Veja também
          </h2>
          <div className="flex flex-wrap gap-2">
            {relacionados.map((r) => (
              <Link
                key={r.slug}
                href={`/ajuda/${r.slug}` as Route}
                className="btn-soft text-xs"
              >
                {r.icone} {r.titulo}
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
