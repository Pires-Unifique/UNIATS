'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { ColaboradorDTO, ConviteOffboardingDTO } from '@uniats/shared';

import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { BADGE_STATUS_CONVITE, ROTULO_STATUS_CONVITE } from '@/lib/offboarding';

function urlAbsoluta(rel: string): string {
  if (typeof window === 'undefined') return rel;
  return `${window.location.origin}${rel}`;
}
function dt(iso?: string | null): string {
  return iso ? new Date(iso).toLocaleString('pt-BR') : '—';
}

export default function ConvitesPage() {
  const { areas } = useAuth();
  const isDho = areas.includes('dho') || areas.includes('admin');

  const [itens, setItens] = useState<ConviteOffboardingDTO[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState<string | null>(null);

  // gerar: busca de colaborador
  const [busca, setBusca] = useState('');
  const [resultados, setResultados] = useState<ColaboradorDTO[]>([]);
  const [sel, setSel] = useState<ColaboradorDTO | null>(null);
  const [gerando, setGerando] = useState(false);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      setItens(await api<ConviteOffboardingDTO[]>('/api/offboarding/convites'));
    } catch (err) {
      setItens([]);
      setErro(err instanceof ApiError ? err.message : 'Falha ao carregar convites.');
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const buscar = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setResultados([]);
      return;
    }
    try {
      setResultados(
        await api<ColaboradorDTO[]>('/api/alteracao-contratual/catalogo/colaboradores', {
          query: { q },
        }),
      );
    } catch {
      setResultados([]);
    }
  }, []);

  async function gerar() {
    if (!sel) {
      setErro('Selecione um colaborador.');
      return;
    }
    setGerando(true);
    setErro(null);
    try {
      await api<ConviteOffboardingDTO>('/api/offboarding/convites', {
        method: 'POST',
        body: {
          colaborador_id: sel.id,
          colaborador_matricula: sel.matricula,
          colaborador_nome: sel.nome,
        },
      });
      setSel(null);
      setBusca('');
      await carregar();
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : 'Falha ao gerar link.');
    } finally {
      setGerando(false);
    }
  }

  async function copiar(rel: string) {
    const url = urlAbsoluta(rel);
    try {
      await navigator.clipboard.writeText(url);
      setCopiado(rel);
      setTimeout(() => setCopiado((c) => (c === rel ? null : c)), 2000);
    } catch {
      window.prompt('Copie o link:', url);
    }
  }

  async function cancelar(id: string) {
    try {
      await api(`/api/offboarding/convites/${id}/cancelar`, { method: 'POST' });
      await carregar();
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : 'Falha ao cancelar.');
    }
  }

  return (
    <div>
      <Link href={'/offboarding' as Route} className="text-sm text-unifique-700 hover:underline">
        ← Voltar
      </Link>

      <PageHeader
        titulo="Links de autodesligamento"
        subtitulo="Gere um link para o colaborador pedir o próprio desligamento (sem login). Uso único e com validade."
      />

      {erro && (
        <div className="card p-3 mb-4 text-sm text-red-700 bg-red-50 border-red-200">
          {erro}
        </div>
      )}

      {isDho && (
        <div className="card p-5 mb-4">
          <label className="block text-sm font-medium text-grafite-700 mb-1">
            Colaborador
          </label>
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <input
                className="inp"
                placeholder="Busque por nome ou matrícula"
                value={busca}
                onChange={(e) => {
                  setBusca(e.target.value);
                  setSel(null);
                  void buscar(e.target.value);
                }}
              />
              {resultados.length > 0 && !sel && (
                <div className="card absolute z-10 mt-1 w-full max-h-48 overflow-auto divide-y divide-grafite-100">
                  {resultados.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className="block w-full text-left px-3 py-2 text-sm hover:bg-grafite-50"
                      onClick={() => {
                        setSel(c);
                        setBusca(`${c.nome} (${c.matricula})`);
                        setResultados([]);
                      }}
                    >
                      {c.nome} <span className="text-grafite-400">({c.matricula})</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button className="btn-primary whitespace-nowrap" disabled={gerando || !sel} onClick={() => void gerar()}>
              {gerando ? 'Gerando…' : 'Gerar link'}
            </button>
          </div>
        </div>
      )}

      {itens && itens.length === 0 && !erro ? (
        <EmptyState titulo="Nenhum link ainda" descricao="Gere o primeiro link de autodesligamento acima." />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-grafite-50 text-grafite-500 text-left text-xs uppercase tracking-wider">
              <tr>
                <th className="px-4 py-2 font-medium">Colaborador</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Expira em</th>
                <th className="px-4 py-2 font-medium">Link</th>
                <th className="px-4 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-grafite-100">
              {(itens ?? []).map((c) => (
                <tr key={c.id} className="hover:bg-grafite-50">
                  <td className="px-4 py-2">
                    <div className="font-medium text-grafite-800">{c.colaborador_nome}</div>
                    <div className="text-xs text-grafite-400">matrícula {c.colaborador_matricula}</div>
                  </td>
                  <td className="px-4 py-2">
                    <span className={BADGE_STATUS_CONVITE[c.status]}>
                      {ROTULO_STATUS_CONVITE[c.status]}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-grafite-600">{dt(c.expira_em)}</td>
                  <td className="px-4 py-2">
                    {c.status === 'PENDENTE' ? (
                      <button
                        className="text-unifique-700 hover:underline text-xs"
                        onClick={() => void copiar(c.url)}
                      >
                        {copiado === c.url ? '✓ Copiado!' : 'Copiar link'}
                      </button>
                    ) : c.solicitacao_id ? (
                      <Link
                        href={`/offboarding/${c.solicitacao_id}` as Route}
                        className="text-unifique-700 hover:underline text-xs"
                      >
                        Ver solicitação
                      </Link>
                    ) : (
                      <span className="text-grafite-300 text-xs">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {isDho && c.status === 'PENDENTE' && (
                      <button
                        className="text-red-600 hover:underline text-xs"
                        onClick={() => void cancelar(c.id)}
                      >
                        Cancelar
                      </button>
                    )}
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
