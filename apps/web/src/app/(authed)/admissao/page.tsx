'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { AdmissaoListItemDTO, StatusAdmissao } from '@uniats/shared';

import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { api, ApiError } from '@/lib/api';
import { ETAPAS_ADMISSAO, ROTULO_ETAPA_ADMISSAO } from '@/lib/admissao';

export default function AdmissaoBoardPage() {
  const [itens, setItens] = useState<AdmissaoListItemDTO[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const lista = await api<AdmissaoListItemDTO[]>('/api/admissoes');
      setItens(lista);
    } catch (err) {
      setItens([]);
      setErro(err instanceof ApiError ? err.message : 'Falha ao carregar admissões.');
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const porEtapa = (s: StatusAdmissao) =>
    (itens ?? []).filter((a) => a.status === s);
  const canceladas = (itens ?? []).filter((a) => a.status === 'CANCELADA');

  return (
    <div>
      <PageHeader
        titulo="Admissões"
        subtitulo="Acompanhe as etapas da admissão dos candidatos contratados."
      />

      {erro && (
        <div className="badge-red mb-4 w-full justify-start px-3 py-2">{erro}</div>
      )}

      {itens === null ? (
        <div className="text-sm text-grafite-400 p-4">Carregando…</div>
      ) : itens.length === 0 ? (
        <EmptyState
          titulo="Nenhuma admissão em andamento"
          descricao="As admissões aparecem aqui quando uma candidatura é contratada e a admissão é iniciada."
        />
      ) : (
        <>
          <div className="flex gap-3 overflow-x-auto pb-4">
            {ETAPAS_ADMISSAO.map((etapa) => {
              const cards = porEtapa(etapa);
              return (
                <div
                  key={etapa}
                  className="w-64 shrink-0 rounded-lg bg-grafite-50 border border-grafite-100"
                >
                  <div className="px-3 py-2 border-b border-grafite-100 flex items-center justify-between">
                    <span className="text-xs font-semibold text-grafite-700">
                      {ROTULO_ETAPA_ADMISSAO[etapa]}
                    </span>
                    <span className="text-xs text-grafite-400">{cards.length}</span>
                  </div>
                  <div className="p-2 space-y-2 min-h-[60px]">
                    {cards.map((a) => (
                      <Cartao key={a.id} a={a} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {canceladas.length > 0 && (
            <div className="mt-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-grafite-400 mb-2">
                Canceladas ({canceladas.length})
              </p>
              <div className="flex flex-wrap gap-2">
                {canceladas.map((a) => (
                  <Cartao key={a.id} a={a} />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Cartao({ a }: { a: AdmissaoListItemDTO }) {
  return (
    <Link
      href={`/admissao/${a.id}`}
      className="block rounded-md bg-white border border-grafite-100 p-3 hover:border-unifique-300 hover:shadow-sm transition"
    >
      <div className="font-medium text-sm text-grafite-900 truncate">
        {a.candidato_nome}
      </div>
      <div className="text-xs text-grafite-500 truncate mt-0.5">
        {a.cargo ?? a.vaga_titulo ?? '—'}
      </div>
    </Link>
  );
}
