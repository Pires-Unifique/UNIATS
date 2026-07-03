'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { StatusBadge } from '@/components/StatusBadge';
import { api, ApiError } from '@/lib/api';
import { formatarData } from '@/lib/format';

interface VagaResumo {
  id: string;
  gupy_id: string;
  codigo: string | null;
  titulo: string;
  departamento: string | null;
  unidade: string | null;
  cidade: string | null;
  estado: string | null;
  remoto: boolean;
  status: string;
  data_publicacao: string | null;
  atualizado_em: string;
  qtdCandidaturas: number;
}

export default function VagasPage() {
  const [vagas, setVagas] = useState<VagaResumo[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [statusFiltro, setStatusFiltro] = useState<string>('PUBLICADA');
  const [sincronizando, setSincronizando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const resp = await api<{ total: number; itens: VagaResumo[] }>(
        '/api/vagas',
        {
          query: {
            status: statusFiltro || undefined,
            q: busca || undefined,
            limite: 200,
          },
        },
      );
      setVagas(resp.itens);
    } catch (err) {
      setVagas([]);
      if (err instanceof ApiError) setErro(err.message);
      else setErro('Falha ao carregar vagas.');
    }
  }, [busca, statusFiltro]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // Sincroniza tudo num passo só: primeiro o cadastro das vagas, depois as
  // candidaturas (que rodam em background na API — acompanhamos o progresso).
  async function sincronizar() {
    setSincronizando(true);
    setErro(null);
    setAviso(null);
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    try {
      // 1) Vagas — endpoint síncrono.
      setAviso('Sincronizando vagas…');
      await api('/api/gupy/sync/vagas', { method: 'POST' });
      await carregar();

      // 2) Candidatos de todas as vagas — background + polling de progresso.
      await api('/api/gupy/sync/candidaturas-todas', { method: 'POST' });
      setAviso('Buscando candidatos de todas as vagas…');
      for (let i = 0; i < 300; i++) {
        await sleep(4000);
        const st = await api<{
          emAndamento: boolean;
          totalVagas: number;
          vagasProcessadas: number;
          candidaturasImportadas: number;
        }>('/api/gupy/sync/candidaturas-todas/status');
        await carregar();
        if (!st.emAndamento) {
          setAviso(
            `Sincronização concluída: ${st.candidaturasImportadas} candidatura(s) em ${st.vagasProcessadas} vaga(s).`,
          );
          break;
        }
        setAviso(
          `Buscando candidatos: ${st.vagasProcessadas}/${st.totalVagas} vagas · ${st.candidaturasImportadas} candidatura(s)…`,
        );
      }
    } catch (err) {
      if (err instanceof ApiError) setErro(err.message);
      else setErro('Falha ao sincronizar com a Gupy.');
    } finally {
      setSincronizando(false);
    }
  }

  return (
    <div>
      <PageHeader
        titulo="Vagas"
        subtitulo="Vagas importadas da Gupy. Clique em uma vaga para ver o ranking de candidatos."
        acoes={
          <button
            type="button"
            className="btn-primary"
            disabled={sincronizando}
            onClick={() => void sincronizar()}
          >
            {sincronizando ? 'Sincronizando…' : 'Sincronizar Gupy'}
          </button>
        }
      />

      {aviso && (
        <div className="badge-green mb-4 w-full justify-start px-3 py-2">
          {aviso}
        </div>
      )}

      <div className="card p-4 mb-4 flex gap-3 items-center">
        <input
          className="flex-1 border border-grafite-200 rounded-md px-3 py-2 text-sm"
          type="search"
          placeholder="Buscar por título…"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
        <select
          className="border border-grafite-200 rounded-md px-3 py-2 text-sm bg-white"
          value={statusFiltro}
          onChange={(e) => setStatusFiltro(e.target.value)}
        >
          <option value="">Todos status</option>
          <option value="PUBLICADA">Publicadas</option>
          <option value="APROVADA">Aprovadas</option>
          <option value="RASCUNHO">Rascunhos</option>
          <option value="PAUSADA">Pausadas</option>
          <option value="ENCERRADA">Encerradas</option>
          <option value="CANCELADA">Canceladas</option>
        </select>
      </div>

      {erro && (
        <div className="badge-red mb-4 w-full justify-start px-3 py-2">
          {erro}
        </div>
      )}

      {vagas === null ? (
        <div className="text-sm text-grafite-400 p-4">Carregando…</div>
      ) : vagas.length === 0 ? (
        <EmptyState
          titulo="Nenhuma vaga ainda"
          descricao="Clique em 'Sincronizar Gupy' para importar."
        />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-grafite-50 text-grafite-600">
              <tr>
                <Th>Título</Th>
                <Th>Departamento</Th>
                <Th>Local</Th>
                <Th>Status</Th>
                <Th>Publicada</Th>
                <Th className="text-right">Candidaturas</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {vagas.map((v) => (
                <tr
                  key={v.id}
                  className="border-t border-grafite-100 hover:bg-grafite-50"
                >
                  <Td>
                    <div className="font-medium text-grafite-900">{v.titulo}</div>
                    {v.codigo && (
                      <div className="text-xs text-grafite-400">{v.codigo}</div>
                    )}
                  </Td>
                  <Td>{v.departamento ?? '—'}</Td>
                  <Td>
                    {v.remoto
                      ? 'Remoto'
                      : [v.cidade, v.estado].filter(Boolean).join(' / ') || '—'}
                  </Td>
                  <Td>
                    <StatusBadge status={v.status} />
                  </Td>
                  <Td>{formatarData(v.data_publicacao)}</Td>
                  <Td className="text-right tabular-nums">{v.qtdCandidaturas}</Td>
                  <Td className="text-right">
                    <Link
                      href={`/vagas/${v.id}/ranking`}
                      className="btn-soft text-xs"
                    >
                      Ver ranking →
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

function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <th className={`text-left font-medium px-4 py-2 text-xs uppercase tracking-wide ${className ?? ''}`}>
      {children}
    </th>
  );
}
function Td({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-3 ${className ?? ''}`}>{children}</td>;
}
