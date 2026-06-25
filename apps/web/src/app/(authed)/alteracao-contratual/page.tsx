'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  ROTULO_STATUS_ALTERACAO,
  ROTULO_TIPO_ALTERACAO,
  type SolicitacaoAlteracaoListItemDTO,
} from '@uniats/shared';

import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { api, ApiError } from '@/lib/api';
import { BADGE_STATUS_ALTERACAO } from '@/lib/alteracao-contratual';

function formatarData(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}

export default function AlteracaoContratualListaPage() {
  const [itens, setItens] = useState<SolicitacaoAlteracaoListItemDTO[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const lista = await api<SolicitacaoAlteracaoListItemDTO[]>(
        '/api/alteracao-contratual',
      );
      setItens(lista);
    } catch (err) {
      setItens([]);
      setErro(
        err instanceof ApiError ? err.message : 'Falha ao carregar solicitações.',
      );
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  return (
    <div>
      <PageHeader
        titulo="Alteração contratual"
        subtitulo="Solicitações de mudança de cargo, salário, centro de custo, unidade ou líder."
        acoes={
          <Link
            href={'/alteracao-contratual/nova' as Route}
            className="btn-primary"
          >
            + Nova solicitação
          </Link>
        }
      />

      {erro && (
        <div className="card p-3 mb-4 text-sm text-red-700 bg-red-50 border-red-200">
          {erro}
        </div>
      )}

      {itens && itens.length === 0 && !erro ? (
        <EmptyState
          titulo="Nenhuma solicitação ainda"
          descricao="Crie a primeira solicitação de alteração contratual."
        />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-grafite-50 text-grafite-500 text-left text-xs uppercase tracking-wider">
              <tr>
                <th className="px-4 py-2 font-medium">Colaborador</th>
                <th className="px-4 py-2 font-medium">Alterações</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Aplicar em</th>
                <th className="px-4 py-2 font-medium">Solicitante</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-grafite-100">
              {(itens ?? []).map((s) => (
                <tr key={s.id} className="hover:bg-grafite-50">
                  <td className="px-4 py-2">
                    <Link
                      href={`/alteracao-contratual/${s.id}` as Route}
                      className="text-unifique-700 font-medium hover:underline"
                    >
                      {s.colaborador_nome}
                    </Link>
                    <div className="text-xs text-grafite-400">
                      matrícula {s.colaborador_matricula}
                    </div>
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap gap-1">
                      {s.tipos.map((t) => (
                        <span key={t} className="badge-gray">
                          {ROTULO_TIPO_ALTERACAO[t]}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-2">
                    <span className={BADGE_STATUS_ALTERACAO[s.status]}>
                      {ROTULO_STATUS_ALTERACAO[s.status]}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-grafite-600">
                    {formatarData(s.data_aplicacao)}
                  </td>
                  <td className="px-4 py-2 text-grafite-600">{s.solicitante_nome}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
