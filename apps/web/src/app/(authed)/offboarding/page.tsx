'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { SolicitacaoOffboardingListItemDTO } from '@uniats/shared';

import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { api, ApiError } from '@/lib/api';
import {
  BADGE_STATUS_OFFBOARDING,
  ROTULO_ORIGEM_OFFBOARDING,
  ROTULO_STATUS_OFFBOARDING,
  ROTULO_TIPO_DESLIGAMENTO,
} from '@/lib/offboarding';

function formatarData(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}

export default function OffboardingListaPage() {
  const [itens, setItens] = useState<SolicitacaoOffboardingListItemDTO[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const lista = await api<SolicitacaoOffboardingListItemDTO[]>('/api/offboarding');
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
        titulo="Offboarding"
        subtitulo="Solicitações de desligamento de colaboradores (pelo líder ou pelo próprio colaborador)."
        acoes={
          <div className="flex gap-2">
            <Link
              href={'/offboarding/convites' as Route}
              className="btn-soft"
            >
              Links de autodesligamento
            </Link>
            <Link
              href={'/offboarding/procuradores' as Route}
              className="btn-soft"
            >
              Procuradores
            </Link>
            <Link href={'/offboarding/nova' as Route} className="btn-primary">
              + Nova solicitação
            </Link>
          </div>
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
          descricao="Crie a primeira solicitação de offboarding."
        />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-grafite-50 text-grafite-500 text-left text-xs uppercase tracking-wider">
              <tr>
                <th className="px-4 py-2 font-medium">Colaborador</th>
                <th className="px-4 py-2 font-medium">Tipo</th>
                <th className="px-4 py-2 font-medium">Origem</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Solicitante</th>
                <th className="px-4 py-2 font-medium">Criada em</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-grafite-100">
              {(itens ?? []).map((s) => (
                <tr key={s.id} className="hover:bg-grafite-50">
                  <td className="px-4 py-2">
                    <Link
                      href={`/offboarding/${s.id}` as Route}
                      className="text-unifique-700 font-medium hover:underline"
                    >
                      {s.colaborador_nome}
                    </Link>
                    <div className="text-xs text-grafite-400">
                      matrícula {s.colaborador_matricula}
                    </div>
                  </td>
                  <td className="px-4 py-2 text-grafite-600">
                    {ROTULO_TIPO_DESLIGAMENTO[s.tipo_desligamento]}
                  </td>
                  <td className="px-4 py-2 text-grafite-600">
                    {ROTULO_ORIGEM_OFFBOARDING[s.origem]}
                  </td>
                  <td className="px-4 py-2">
                    <span className={BADGE_STATUS_OFFBOARDING[s.status]}>
                      {ROTULO_STATUS_OFFBOARDING[s.status]}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-grafite-600">{s.solicitante_nome}</td>
                  <td className="px-4 py-2 text-grafite-600">
                    {formatarData(s.criado_em)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
