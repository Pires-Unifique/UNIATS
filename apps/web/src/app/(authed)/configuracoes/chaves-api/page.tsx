'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ChaveApiCriadaDTO, ChaveApiDTO } from '@uniats/shared';

import { PageHeader } from '@/components/PageHeader';
import { api, ApiError } from '@/lib/api';
import { ESCOPOS_CHAVE_API, labelArea } from '@/lib/areas';
import { formatarDataHora } from '@/lib/format';

const VALIDADES = [
  { valor: 90, label: '90 dias (recomendado)' },
  { valor: 365, label: '1 ano' },
  { valor: null, label: 'Sem expiração' },
] as const;

interface FormChave {
  nome: string;
  escopos: string[];
  validade_dias: number | null;
}

const FORM_VAZIO: FormChave = { nome: '', escopos: [], validade_dias: 90 };

export default function ChavesApiPage() {
  const [chaves, setChaves] = useState<ChaveApiDTO[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const [form, setForm] = useState<FormChave>(FORM_VAZIO);
  const [gerando, setGerando] = useState(false);
  // Chave recém-criada — única chance de copiar o valor completo.
  const [novaChave, setNovaChave] = useState<ChaveApiCriadaDTO | null>(null);
  const [copiada, setCopiada] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const r = await api<ChaveApiDTO[]>('/api/chaves-api');
      setChaves(r);
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : 'Falha ao carregar as chaves.');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  function alternarEscopo(escopo: string) {
    setForm((f) => ({
      ...f,
      escopos: f.escopos.includes(escopo)
        ? f.escopos.filter((e) => e !== escopo)
        : [...f.escopos, escopo],
    }));
  }

  async function gerar() {
    if (!form.nome.trim()) {
      setErro('Dê um nome à chave (para que serve).');
      return;
    }
    if (form.escopos.length === 0) {
      setErro('Selecione ao menos um escopo.');
      return;
    }
    setErro(null);
    setGerando(true);
    try {
      const criada = await api<ChaveApiCriadaDTO>('/api/chaves-api', {
        method: 'POST',
        body: form,
      });
      setNovaChave(criada);
      setCopiada(false);
      setForm(FORM_VAZIO);
      await carregar();
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : 'Falha ao gerar a chave.');
    } finally {
      setGerando(false);
    }
  }

  async function copiar() {
    if (!novaChave) return;
    try {
      await navigator.clipboard.writeText(novaChave.chave);
      setCopiada(true);
    } catch {
      setErro('Não foi possível copiar — selecione o texto manualmente.');
    }
  }

  async function revogar(c: ChaveApiDTO) {
    if (
      typeof window !== 'undefined' &&
      !window.confirm(
        `Revogar a chave "${c.nome}"? A próxima requisição dela já falha — não dá para desfazer.`,
      )
    ) {
      return;
    }
    setErro(null);
    try {
      await api(`/api/chaves-api/${c.id}/revogar`, { method: 'POST' });
      await carregar();
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : 'Falha ao revogar a chave.');
    }
  }

  return (
    <div>
      <PageHeader
        titulo="Chaves de API"
        subtitulo="Acesso de sistema (integrações, scripts, BI) à API do Collab. Cada chave entra pelo header x-api-key, limitada aos escopos marcados. A chave completa é exibida uma única vez — guardamos apenas o hash."
      />

      {erro && (
        <div className="badge-red mb-4 w-full justify-start px-3 py-2">{erro}</div>
      )}

      {/* Gerar nova chave */}
      <div className="card p-4 mb-6 space-y-4">
        <h2 className="font-semibold text-grafite-900">Gerar nova chave</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Campo label="Nome (para que serve) *">
            <input
              className="inp"
              value={form.nome}
              placeholder="Ex.: Integração UNIIT — leitura de vagas"
              onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))}
            />
          </Campo>
          <Campo label="Validade">
            <select
              className="inp"
              value={form.validade_dias === null ? 'null' : String(form.validade_dias)}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  validade_dias: e.target.value === 'null' ? null : Number(e.target.value),
                }))
              }
            >
              {VALIDADES.map((v) => (
                <option key={String(v.valor)} value={v.valor === null ? 'null' : v.valor}>
                  {v.label}
                </option>
              ))}
            </select>
          </Campo>
        </div>
        <div>
          <span className="block text-sm font-medium text-grafite-700 mb-2">
            Escopos (o que a chave pode acessar)
          </span>
          <div className="flex flex-wrap gap-2">
            {ESCOPOS_CHAVE_API.map((e) => {
              const marcado = form.escopos.includes(e.valor);
              return (
                <label
                  key={e.valor}
                  className={`inline-flex items-center gap-2 border rounded-md px-3 py-1.5 text-sm cursor-pointer transition-colors ${
                    marcado
                      ? 'border-unifique-200 bg-unifique-50 text-unifique-700 dark:bg-unifique-500/15 dark:text-unifique-300 dark:border-unifique-500/40'
                      : 'border-grafite-200 text-grafite-600 hover:bg-grafite-100'
                  }`}
                >
                  <input
                    type="checkbox"
                    className="accent-unifique-600"
                    checked={marcado}
                    onChange={() => alternarEscopo(e.valor)}
                  />
                  {e.label}
                </label>
              );
            })}
          </div>
          <p className="text-xs text-grafite-400 mt-1.5">
            Chave não pode ter escopo Admin — gestão de usuários e chaves é só
            para pessoas logadas.
          </p>
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            className="btn-primary"
            disabled={gerando}
            onClick={() => void gerar()}
          >
            {gerando ? 'Gerando…' : 'Gerar chave'}
          </button>
        </div>

        {novaChave && (
          <div className="border border-dashed border-unifique-200 bg-unifique-50 dark:bg-unifique-500/10 dark:border-unifique-500/40 rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between gap-3 bg-white border border-grafite-200 rounded-md px-3 py-2 overflow-x-auto">
              <code className="text-sm text-grafite-900 whitespace-nowrap">
                {novaChave.chave}
              </code>
              <button type="button" className="btn-soft text-xs shrink-0" onClick={() => void copiar()}>
                {copiada ? 'Copiada ✓' : 'Copiar'}
              </button>
            </div>
            <p className="text-xs text-unifique-700 dark:text-unifique-300">
              <strong>Copie agora.</strong> Por segurança, a chave “{novaChave.nome}”
              não será exibida de novo — se perder, revogue e gere outra.
            </p>
          </div>
        )}
      </div>

      {/* Lista */}
      {carregando ? (
        <p className="text-sm text-grafite-400">Carregando chaves…</p>
      ) : chaves.length === 0 ? (
        <div className="card p-6 text-sm text-grafite-500">
          Nenhuma chave criada ainda. Use o formulário acima para gerar a primeira.
        </div>
      ) : (
        <ul className="space-y-3">
          {chaves.map((c) => {
            const expirada =
              !c.revogado_em && c.expira_em && new Date(c.expira_em).getTime() < Date.now();
            const inativa = Boolean(c.revogado_em) || Boolean(expirada);
            return (
              <li key={c.id} className={`card p-4 ${inativa ? 'opacity-60' : ''}`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-grafite-900">{c.nome}</span>
                      {c.escopos.map((e) => (
                        <span key={e} className="badge-blue px-2 py-0.5 text-xs">
                          {labelArea(e)}
                        </span>
                      ))}
                      {c.revogado_em && (
                        <span className="badge-red px-2 py-0.5 text-xs">revogada</span>
                      )}
                      {expirada && (
                        <span className="badge-yellow px-2 py-0.5 text-xs">expirada</span>
                      )}
                    </div>
                    <p className="text-xs text-grafite-400 mt-0.5 font-mono">{c.prefixo}…</p>
                    <p className="text-xs text-grafite-400 mt-1">
                      Criada em {formatarDataHora(c.criado_em)}
                      {c.criado_por_nome ? ` por ${c.criado_por_nome}` : ''}
                      {' · '}
                      {c.expira_em ? `expira em ${formatarDataHora(c.expira_em)}` : 'sem expiração'}
                      {' · '}
                      {c.ultimo_uso_em
                        ? `último uso em ${formatarDataHora(c.ultimo_uso_em)}`
                        : 'nunca usada'}
                    </p>
                  </div>
                  {!c.revogado_em && (
                    <button
                      type="button"
                      className="btn-soft-danger text-xs shrink-0"
                      onClick={() => void revogar(c)}
                    >
                      Revogar
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-grafite-700 mb-1">{label}</span>
      {children}
    </label>
  );
}
