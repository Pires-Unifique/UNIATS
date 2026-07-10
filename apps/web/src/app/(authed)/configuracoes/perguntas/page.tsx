'use client';

import { useCallback, useEffect, useState } from 'react';

import { PageHeader } from '@/components/PageHeader';
import { api, ApiError } from '@/lib/api';

interface PerguntaPadraoDTO {
  id: string;
  pergunta: string;
  objetivo: string | null;
  competencia: string | null;
  categoria: string | null;
  ativo: boolean;
  ordem: number;
  criado_por: string | null;
  criado_em: string;
}

interface FormState {
  pergunta: string;
  objetivo: string;
  competencia: string;
  categoria: string;
}

const FORM_VAZIO: FormState = {
  pergunta: '',
  objetivo: '',
  competencia: '',
  categoria: '',
};

/**
 * Banco de perguntas padrão da empresa (cultura, valores, disponibilidade…).
 * Enquanto ATIVAS, entram automaticamente na análise pós-reunião de TODAS as
 * entrevistas — a IA verifica na transcrição o que o candidato respondeu.
 */
export default function PerguntasPadraoPage() {
  const [perguntas, setPerguntas] = useState<PerguntaPadraoDTO[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(FORM_VAZIO);
  const [salvando, setSalvando] = useState(false);
  // Edição inline: id da pergunta em edição + rascunho.
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState<FormState>(FORM_VAZIO);

  const carregar = useCallback(async () => {
    setErro(null);
    setCarregando(true);
    try {
      const lista = await api<PerguntaPadraoDTO[]>('/api/perguntas-padrao', {
        query: { incluirInativas: 'true' },
      });
      setPerguntas(lista);
    } catch (err) {
      setErro(
        err instanceof ApiError ? err.message : 'Falha ao carregar perguntas.',
      );
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function criar() {
    if (salvando) return;
    if (form.pergunta.trim().length < 10) {
      setAviso('A pergunta precisa ter pelo menos 10 caracteres.');
      return;
    }
    setSalvando(true);
    setAviso(null);
    try {
      await api('/api/perguntas-padrao', {
        method: 'POST',
        body: {
          pergunta: form.pergunta.trim(),
          objetivo: form.objetivo.trim() || undefined,
          competencia: form.competencia.trim() || undefined,
          categoria: form.categoria.trim() || undefined,
        },
      });
      setForm(FORM_VAZIO);
      await carregar();
      setAviso('Pergunta cadastrada — entra nas próximas análises.');
    } catch (err) {
      setAviso(err instanceof ApiError ? err.message : 'Falha ao cadastrar.');
    } finally {
      setSalvando(false);
    }
  }

  function iniciarEdicao(p: PerguntaPadraoDTO) {
    setEditandoId(p.id);
    setRascunho({
      pergunta: p.pergunta,
      objetivo: p.objetivo ?? '',
      competencia: p.competencia ?? '',
      categoria: p.categoria ?? '',
    });
  }

  async function salvarEdicao(id: string) {
    if (rascunho.pergunta.trim().length < 10) {
      setAviso('A pergunta precisa ter pelo menos 10 caracteres.');
      return;
    }
    try {
      await api(`/api/perguntas-padrao/${id}`, {
        method: 'PATCH',
        body: {
          pergunta: rascunho.pergunta.trim(),
          objetivo: rascunho.objetivo.trim() || null,
          competencia: rascunho.competencia.trim() || null,
          categoria: rascunho.categoria.trim() || null,
        },
      });
      setEditandoId(null);
      await carregar();
    } catch (err) {
      setAviso(err instanceof ApiError ? err.message : 'Falha ao salvar.');
    }
  }

  async function alternarAtivo(p: PerguntaPadraoDTO) {
    try {
      await api(`/api/perguntas-padrao/${p.id}`, {
        method: 'PATCH',
        body: { ativo: !p.ativo },
      });
      setPerguntas((atual) =>
        atual.map((x) => (x.id === p.id ? { ...x, ativo: !p.ativo } : x)),
      );
    } catch (err) {
      setAviso(err instanceof ApiError ? err.message : 'Falha ao atualizar.');
    }
  }

  async function excluir(id: string) {
    try {
      await api(`/api/perguntas-padrao/${id}`, { method: 'DELETE' });
      setPerguntas((atual) => atual.filter((x) => x.id !== id));
      setAviso(
        'Pergunta excluída. Análises já feitas não mudam (guardam o texto da época).',
      );
    } catch (err) {
      setAviso(err instanceof ApiError ? err.message : 'Falha ao excluir.');
    }
  }

  return (
    <div>
      <PageHeader
        titulo="Perguntas padrão"
        subtitulo="Perguntas institucionais (cultura, valores…) verificadas pela IA em toda entrevista, além das perguntas da vaga."
      />

      {aviso && (
        <div className="badge-blue mb-4 px-3 py-2 w-full justify-start">
          {aviso}
        </div>
      )}
      {erro && <div className="badge-red p-3 mb-4">{erro}</div>}

      {/* Cadastro */}
      <section className="card p-5 mb-4">
        <h2 className="font-medium text-grafite-900 mb-3">Nova pergunta</h2>
        <div className="space-y-2">
          <textarea
            className="w-full min-h-[64px] resize-y rounded-md border border-grafite-200 p-2 text-sm text-grafite-800 focus:border-unifique-500 focus:outline-none focus:ring-1 focus:ring-unifique-500"
            placeholder="Ex.: O que você conhece da Unifique e por que quer trabalhar aqui?"
            value={form.pergunta}
            onChange={(ev) => setForm({ ...form, pergunta: ev.target.value })}
          />
          <div className="grid grid-cols-3 gap-2">
            <input
              className="rounded-md border border-grafite-200 p-2 text-sm text-grafite-800 focus:border-unifique-500 focus:outline-none focus:ring-1 focus:ring-unifique-500"
              placeholder="Objetivo (opcional)"
              value={form.objetivo}
              onChange={(ev) => setForm({ ...form, objetivo: ev.target.value })}
            />
            <input
              className="rounded-md border border-grafite-200 p-2 text-sm text-grafite-800 focus:border-unifique-500 focus:outline-none focus:ring-1 focus:ring-unifique-500"
              placeholder="Eixo avaliado (ex.: Fit cultural)"
              value={form.competencia}
              onChange={(ev) =>
                setForm({ ...form, competencia: ev.target.value })
              }
            />
            <input
              className="rounded-md border border-grafite-200 p-2 text-sm text-grafite-800 focus:border-unifique-500 focus:outline-none focus:ring-1 focus:ring-unifique-500"
              placeholder="Categoria (ex.: cultura)"
              value={form.categoria}
              onChange={(ev) =>
                setForm({ ...form, categoria: ev.target.value })
              }
            />
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              className="btn-soft text-xs"
              disabled={salvando}
              onClick={() => void criar()}
            >
              {salvando ? 'Salvando…' : 'Cadastrar pergunta'}
            </button>
          </div>
        </div>
      </section>

      {/* Lista */}
      <section className="card p-5">
        <h2 className="font-medium text-grafite-900 mb-3">
          Perguntas cadastradas
        </h2>
        {carregando ? (
          <p className="text-sm text-grafite-400">Carregando…</p>
        ) : perguntas.length === 0 ? (
          <p className="text-sm text-grafite-400">
            Nenhuma pergunta padrão ainda. Cadastre acima as perguntas que a
            empresa quer ver respondidas em toda entrevista.
          </p>
        ) : (
          <ol className="space-y-4">
            {perguntas.map((p) => (
              <li
                key={p.id}
                className={`border-l-2 pl-3 ${
                  p.ativo ? 'border-unifique-500' : 'border-grafite-200'
                }`}
              >
                {editandoId === p.id ? (
                  <div className="space-y-2">
                    <textarea
                      className="w-full min-h-[64px] resize-y rounded-md border border-grafite-200 p-2 text-sm text-grafite-800 focus:border-unifique-500 focus:outline-none focus:ring-1 focus:ring-unifique-500"
                      value={rascunho.pergunta}
                      onChange={(ev) =>
                        setRascunho({ ...rascunho, pergunta: ev.target.value })
                      }
                    />
                    <div className="grid grid-cols-3 gap-2">
                      <input
                        className="rounded-md border border-grafite-200 p-2 text-sm text-grafite-800"
                        placeholder="Objetivo"
                        value={rascunho.objetivo}
                        onChange={(ev) =>
                          setRascunho({
                            ...rascunho,
                            objetivo: ev.target.value,
                          })
                        }
                      />
                      <input
                        className="rounded-md border border-grafite-200 p-2 text-sm text-grafite-800"
                        placeholder="Eixo avaliado"
                        value={rascunho.competencia}
                        onChange={(ev) =>
                          setRascunho({
                            ...rascunho,
                            competencia: ev.target.value,
                          })
                        }
                      />
                      <input
                        className="rounded-md border border-grafite-200 p-2 text-sm text-grafite-800"
                        placeholder="Categoria"
                        value={rascunho.categoria}
                        onChange={(ev) =>
                          setRascunho({
                            ...rascunho,
                            categoria: ev.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="flex gap-2 justify-end">
                      <button
                        type="button"
                        className="btn-soft text-xs"
                        onClick={() => setEditandoId(null)}
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        className="btn-soft text-xs"
                        onClick={() => void salvarEdicao(p.id)}
                      >
                        Salvar
                      </button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="flex items-baseline gap-2 mb-1">
                      <span
                        className={p.ativo ? 'badge-green' : 'badge-gray'}
                        title={
                          p.ativo
                            ? 'Entra na análise de todas as entrevistas'
                            : 'Fora das próximas análises'
                        }
                      >
                        {p.ativo ? 'ativa' : 'inativa'}
                      </span>
                      {p.categoria && (
                        <span className="badge-blue">{p.categoria}</span>
                      )}
                      {p.competencia && (
                        <span className="badge-blue">{p.competencia}</span>
                      )}
                      <span className="ml-auto flex gap-3 text-xs">
                        <button
                          type="button"
                          className="text-grafite-400 hover:text-grafite-700"
                          onClick={() => iniciarEdicao(p)}
                        >
                          editar
                        </button>
                        <button
                          type="button"
                          className="text-grafite-400 hover:text-grafite-700"
                          onClick={() => void alternarAtivo(p)}
                        >
                          {p.ativo ? 'desativar' : 'ativar'}
                        </button>
                        <button
                          type="button"
                          className="text-grafite-400 hover:text-red-600"
                          onClick={() => void excluir(p.id)}
                        >
                          excluir
                        </button>
                      </span>
                    </div>
                    <p className="text-sm text-grafite-900">{p.pergunta}</p>
                    {p.objetivo && (
                      <p className="text-xs text-grafite-400 mt-1">
                        🎯 {p.objetivo}
                      </p>
                    )}
                    {p.criado_por && (
                      <p className="text-xs text-grafite-400 mt-0.5">
                        cadastrada por {p.criado_por}
                      </p>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
