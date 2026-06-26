'use client';

import type { Route } from 'next';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { ProcuradorDTO } from '@uniats/shared';

import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export default function ProcuradoresPage() {
  const { areas } = useAuth();
  const isDho = areas.includes('dho') || areas.includes('admin');

  const [itens, setItens] = useState<ProcuradorDTO[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  // formulário de criação
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [documento, setDocumento] = useState('');
  const [cargo, setCargo] = useState('');
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      setItens(await api<ProcuradorDTO[]>('/api/offboarding/procuradores', { query: { inativos: '1' } }));
    } catch (err) {
      setItens([]);
      setErro(err instanceof ApiError ? err.message : 'Falha ao carregar procuradores.');
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function criar() {
    if (!nome.trim()) {
      setErro('Informe o nome do procurador.');
      return;
    }
    setSalvando(true);
    setErro(null);
    try {
      await api('/api/offboarding/procuradores', {
        method: 'POST',
        body: {
          nome: nome.trim(),
          email: email.trim() || null,
          documento: documento.trim() || null,
          cargo: cargo.trim() || null,
        },
      });
      setNome('');
      setEmail('');
      setDocumento('');
      setCargo('');
      await carregar();
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : 'Falha ao salvar.');
    } finally {
      setSalvando(false);
    }
  }

  async function alternarAtivo(p: ProcuradorDTO) {
    try {
      await api(`/api/offboarding/procuradores/${p.id}`, {
        method: 'PATCH',
        body: { ativo: !p.ativo },
      });
      await carregar();
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : 'Falha ao atualizar.');
    }
  }

  return (
    <div>
      <Link href={'/offboarding' as Route} className="text-sm text-unifique-700 hover:underline">
        ← Voltar
      </Link>

      <PageHeader
        titulo="Procuradores"
        subtitulo="Pessoas que podem assinar como representante da empresa na via física do offboarding."
      />

      {erro && (
        <div className="card p-3 mb-4 text-sm text-red-700 bg-red-50 border-red-200">
          {erro}
        </div>
      )}

      {isDho && (
        <div className="card p-5 mb-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
          <div className="lg:col-span-2">
            <label className="block text-sm font-medium text-grafite-700 mb-1">* Nome</label>
            <input className="inp" value={nome} onChange={(e) => setNome(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-grafite-700 mb-1">E-mail</label>
            <input className="inp" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-grafite-700 mb-1">Documento</label>
            <input className="inp" value={documento} onChange={(e) => setDocumento(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <input
              className="inp"
              placeholder="Cargo"
              value={cargo}
              onChange={(e) => setCargo(e.target.value)}
            />
            <button className="btn-primary whitespace-nowrap" disabled={salvando} onClick={() => void criar()}>
              {salvando ? '…' : 'Adicionar'}
            </button>
          </div>
        </div>
      )}

      {itens && itens.length === 0 && !erro ? (
        <EmptyState titulo="Nenhum procurador" descricao="Cadastre o primeiro procurador acima." />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-grafite-50 text-grafite-500 text-left text-xs uppercase tracking-wider">
              <tr>
                <th className="px-4 py-2 font-medium">Nome</th>
                <th className="px-4 py-2 font-medium">E-mail</th>
                <th className="px-4 py-2 font-medium">Documento</th>
                <th className="px-4 py-2 font-medium">Cargo</th>
                <th className="px-4 py-2 font-medium">Status</th>
                {isDho && <th className="px-4 py-2 font-medium"></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-grafite-100">
              {(itens ?? []).map((p) => (
                <tr key={p.id} className="hover:bg-grafite-50">
                  <td className="px-4 py-2 font-medium text-grafite-800">{p.nome}</td>
                  <td className="px-4 py-2 text-grafite-600">{p.email || '—'}</td>
                  <td className="px-4 py-2 text-grafite-600">{p.documento || '—'}</td>
                  <td className="px-4 py-2 text-grafite-600">{p.cargo || '—'}</td>
                  <td className="px-4 py-2">
                    <span className={p.ativo ? 'badge-green' : 'badge-gray'}>
                      {p.ativo ? 'Ativo' : 'Inativo'}
                    </span>
                  </td>
                  {isDho && (
                    <td className="px-4 py-2 text-right">
                      <button
                        className="text-xs text-unifique-700 hover:underline"
                        onClick={() => void alternarAtivo(p)}
                      >
                        {p.ativo ? 'Desativar' : 'Reativar'}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
