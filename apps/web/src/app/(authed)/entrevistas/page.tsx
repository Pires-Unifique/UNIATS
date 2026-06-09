'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { StatusBadge } from '@/components/StatusBadge';
import { api, ApiError } from '@/lib/api';
import { formatarDataHora } from '@/lib/format';

interface EntrevistaAgenda {
  id: string;
  agendada_para: string;
  duracao_estimada_min: number;
  status: string;
  bot_status: string | null;
  meet_url: string | null;
  candidatura: {
    id: string;
    vaga: { titulo: string } | null;
  } | null;
  candidato: { nome_completo: string } | null;
  entrevistador: { nome: string } | null;
}

export default function EntrevistasIndex() {
  const [entrevistas, setEntrevistas] = useState<EntrevistaAgenda[] | null>(
    null,
  );
  const [erro, setErro] = useState<string | null>(null);
  const [statusFiltro, setStatusFiltro] = useState<string>('AGENDADA');

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const itens = await api<EntrevistaAgenda[]>('/api/entrevistas', {
        query: { status: statusFiltro || undefined },
      });
      setEntrevistas(itens);
    } catch (err) {
      setEntrevistas([]);
      if (err instanceof ApiError) setErro(err.message);
      else setErro('Falha ao carregar entrevistas.');
    }
  }, [statusFiltro]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  return (
    <div>
      <PageHeader
        titulo="Entrevistas"
        subtitulo="Entrevistas agendadas pelos recrutadores."
      />

      <div className="card p-4 mb-4 flex gap-3 items-center">
        <select
          className="border border-grafite-200 rounded-md px-3 py-2 text-sm bg-white"
          value={statusFiltro}
          onChange={(e) => setStatusFiltro(e.target.value)}
        >
          <option value="AGENDADA">Agendadas</option>
          <option value="EM_ANDAMENTO">Em andamento</option>
          <option value="FINALIZADA">Finalizadas</option>
          <option value="CANCELADA">Canceladas</option>
          <option value="">Todas</option>
        </select>
      </div>

      {erro && (
        <div className="badge-red mb-4 w-full justify-start px-3 py-2">
          {erro}
        </div>
      )}

      {entrevistas === null ? (
        <div className="text-sm text-grafite-400 p-4">Carregando…</div>
      ) : entrevistas.length === 0 ? (
        <EmptyState
          titulo="Nenhuma entrevista"
          descricao="Agende uma entrevista a partir do detalhe de uma candidatura (vaga → ranking → candidato)."
        />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-grafite-50 text-grafite-600">
              <tr>
                <Th>Quando</Th>
                <Th>Candidato</Th>
                <Th>Vaga</Th>
                <Th>Entrevistador</Th>
                <Th>Status</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {entrevistas.map((e) => (
                <tr
                  key={e.id}
                  className="border-t border-grafite-100 hover:bg-grafite-50"
                >
                  <Td>
                    <div className="font-medium text-grafite-900">
                      {formatarDataHora(e.agendada_para)}
                    </div>
                    <div className="text-xs text-grafite-400">
                      {e.duracao_estimada_min} min
                    </div>
                  </Td>
                  <Td>{e.candidato?.nome_completo ?? '—'}</Td>
                  <Td>{e.candidatura?.vaga?.titulo ?? '—'}</Td>
                  <Td>{e.entrevistador?.nome ?? '—'}</Td>
                  <Td>
                    <StatusBadge status={e.status} />
                    {e.bot_status && (
                      <div className="text-xs text-grafite-400 mt-1">
                        Bot: {e.bot_status}
                      </div>
                    )}
                  </Td>
                  <Td className="text-right">
                    <Link
                      href={`/entrevistas/${e.id}`}
                      className="text-unifique-700 hover:underline text-xs"
                    >
                      Abrir →
                    </Link>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Th({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      className={`text-left font-medium px-4 py-2 text-xs uppercase tracking-wide ${className ?? ''}`}
    >
      {children}
    </th>
  );
}
function Td({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return <td className={`px-4 py-3 ${className ?? ''}`}>{children}</td>;
}
