'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

const STATUS_AGENDA = [
  'AGENDADA',
  'EM_ANDAMENTO',
  'FINALIZADA',
  'CANCELADA',
  'NAO_COMPARECEU',
];

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

// useSearchParams exige Suspense no page (regra do App Router no build).
export default function EntrevistasIndex() {
  return (
    <Suspense
      fallback={<div className="text-sm text-grafite-400 p-4">Carregando…</div>}
    >
      <EntrevistasIndexInner />
    </Suspense>
  );
}

function EntrevistasIndexInner() {
  // Deep-link do painel inicial ("Precisa de você"): /entrevistas?status=...
  // ou ?pendencia=sem_parecer (finalizadas sem parecer final). Inicializa
  // DIRETO da URL (evita o fetch sem filtro que, chegando depois, sobrescrevia
  // a lista filtrada) e reage a navegações com outra query.
  const searchParams = useSearchParams();
  const statusUrl = searchParams.get('status');
  const pendenciaUrl = searchParams.get('pendencia');
  // 'SEM_PARECER' é valor sintético do select — vira ?pendencia=sem_parecer.
  const filtroUrl =
    pendenciaUrl === 'sem_parecer'
      ? 'SEM_PARECER'
      : statusUrl && STATUS_AGENDA.includes(statusUrl)
        ? statusUrl
        : null;

  const [entrevistas, setEntrevistas] = useState<EntrevistaAgenda[] | null>(
    null,
  );
  const [erro, setErro] = useState<string | null>(null);
  const [statusFiltro, setStatusFiltro] = useState<string>(
    filtroUrl ?? 'AGENDADA',
  );

  useEffect(() => {
    if (filtroUrl) setStatusFiltro(filtroUrl);
  }, [filtroUrl]);

  // Aborta a requisição anterior — evita resposta velha fora de ordem.
  const abortRef = useRef<AbortController | null>(null);
  const carregar = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setErro(null);
    try {
      const itens = await api<EntrevistaAgenda[]>('/api/entrevistas', {
        query:
          statusFiltro === 'SEM_PARECER'
            ? { pendencia: 'sem_parecer' }
            : { status: statusFiltro || undefined },
        signal: ctrl.signal,
      });
      setEntrevistas(itens);
    } catch (err) {
      if (ctrl.signal.aborted) return; // requisição substituída — ignora
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
        titulo="Agenda"
        subtitulo="Entrevistas agendadas — você vê as das suas vagas."
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
          <option value="SEM_PARECER">Finalizadas sem parecer</option>
          <option value="CANCELADA">Canceladas</option>
          <option value="NAO_COMPARECEU">No-show</option>
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
          descricao="Agende uma entrevista a partir do detalhe de uma candidatura (Vagas → Ver detalhes → candidato)."
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
                      className="btn-soft text-xs"
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
