'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

import { PageHeader } from '@/components/PageHeader';
import { useAuth } from '@/lib/auth';
import { ARTIGOS, SECOES, artigosVisiveis, buscar } from '@/lib/ajuda/indice';
import type { Artigo } from '@/lib/ajuda/indice';

export default function AjudaPage() {
  const { areas } = useAuth();
  const [termo, setTermo] = useState('');

  // Índice enxuto: só o que a pessoa consegue usar. O artigo em si nunca é
  // bloqueado — link direto sempre abre.
  const disponiveis = useMemo(() => artigosVisiveis(areas), [areas]);
  const resultados = useMemo(
    () => buscar(termo, disponiveis),
    [termo, disponiveis],
  );
  const buscando = termo.trim().length > 0;

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        titulo="Ajuda"
        subtitulo="Como usar o Collab, tela por tela. Escrito para quem opera o processo — não é documentação técnica."
      />

      <div className="card mb-6 p-4">
        <input
          type="search"
          className="w-full rounded-md border border-grafite-200 px-3 py-2 text-sm"
          placeholder="Buscar na ajuda… (ex.: enquete, nota da IA, reprovar, WhatsApp)"
          value={termo}
          onChange={(e) => setTermo(e.target.value)}
          autoFocus
        />
        {buscando && (
          <p className="mt-2 text-xs text-grafite-400">
            {resultados.length === 0
              ? 'Nenhum artigo encontrado.'
              : `${resultados.length} artigo(s) encontrado(s).`}
          </p>
        )}
      </div>

      {buscando ? (
        <div className="space-y-2">
          {resultados.map((a) => (
            <CartaoArtigo key={a.slug} artigo={a} />
          ))}
          {resultados.length === 0 && (
            <div className="card p-6 text-sm text-grafite-500">
              Tente outra palavra — a busca olha o texto inteiro dos artigos. Se
              o assunto não estiver aqui, fale com o time de Recrutamento ou com
              o DHO.
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-8">
          {SECOES.map((secao) => {
            const daSecao = disponiveis.filter((a) => a.secao === secao.id);
            if (daSecao.length === 0) return null;
            return (
              <section key={secao.id}>
                <h2 className="text-sm font-semibold text-grafite-900">
                  {secao.titulo}
                </h2>
                <p className="mb-3 mt-0.5 text-xs text-grafite-400">
                  {secao.descricao}
                </p>
                <div className="space-y-2">
                  {daSecao.map((a) => (
                    <CartaoArtigo key={a.slug} artigo={a} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <p className="mt-8 text-xs text-grafite-400">
        {ARTIGOS.length} artigos no total. Achou algo desatualizado ou faltando?
        Avise o time — a ajuda vive junto do código e é corrigida com ele.
      </p>
    </div>
  );
}

function CartaoArtigo({ artigo }: { artigo: Artigo }) {
  return (
    <Link
      href={`/ajuda/${artigo.slug}`}
      className="card flex items-start gap-3 p-4 transition-colors hover:border-unifique-200 hover:bg-grafite-50"
    >
      <span aria-hidden className="text-lg leading-none">
        {artigo.icone}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-grafite-900">
          {artigo.titulo}
        </span>
        <span className="mt-0.5 block text-xs leading-relaxed text-grafite-500">
          {artigo.resumo}
        </span>
      </span>
    </Link>
  );
}
