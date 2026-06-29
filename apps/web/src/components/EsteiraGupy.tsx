'use client';

import { useCallback, useEffect, useState } from 'react';

import { api, ApiError } from '@/lib/api';

interface Etapa {
  id: number;
  name: string;
  type?: string | null;
}

interface Props {
  /** jobId na Gupy (vaga.gupy_id). */
  jobId: string;
  /** applicationId na Gupy (candidatura.gupy_id). */
  applicationId: string;
  /** Nome da etapa atual (candidatura.etapa_gupy). */
  etapaAtual: string | null;
  /** Chamado após mover/reprovar para recarregar a candidatura. */
  onMoved: (aviso: string) => void;
}

/**
 * Esteira (etapas/steps) da vaga na Gupy. Lista as etapas em ordem, destaca a
 * atual e permite mover o candidato para qualquer etapa (anterior/próxima ou
 * pular) e reprovar com motivo — tudo via API da Gupy.
 */
export function EsteiraGupy({ jobId, applicationId, etapaAtual, onMoved }: Props) {
  const [etapas, setEtapas] = useState<Etapa[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [movendo, setMovendo] = useState(false);
  const [reprovando, setReprovando] = useState(false);
  const [motivo, setMotivo] = useState('');

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const lista = await api<Etapa[]>(`/api/gupy/vagas/${jobId}/etapas`);
      setEtapas(lista);
    } catch (err) {
      setEtapas([]);
      setErro(
        err instanceof ApiError
          ? err.message
          : 'Falha ao carregar etapas da Gupy.',
      );
    }
  }, [jobId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const idxAtual =
    etapas && etapaAtual ? etapas.findIndex((e) => e.name === etapaAtual) : -1;

  async function mover(etapa: Etapa) {
    setMovendo(true);
    setErro(null);
    try {
      await api(`/api/gupy/vagas/${jobId}/candidaturas/${applicationId}`, {
        method: 'PATCH',
        body: { currentStepId: etapa.id, etapaNome: etapa.name },
      });
      onMoved(`Candidato movido para "${etapa.name}".`);
    } catch (err) {
      setErro(
        err instanceof ApiError ? err.message : 'Falha ao mover candidatura.',
      );
    } finally {
      setMovendo(false);
    }
  }

  async function reprovar() {
    setMovendo(true);
    setErro(null);
    try {
      await api(`/api/gupy/vagas/${jobId}/candidaturas/${applicationId}`, {
        method: 'PATCH',
        body: {
          status: 'reproved',
          disapprovalReasonNotes: motivo.trim() || undefined,
        },
      });
      setReprovando(false);
      setMotivo('');
      onMoved('Candidato reprovado na Gupy.');
    } catch (err) {
      setErro(
        err instanceof ApiError ? err.message : 'Falha ao reprovar candidatura.',
      );
    } finally {
      setMovendo(false);
    }
  }

  const temEtapas = etapas && etapas.length > 0;
  const podeAnterior = idxAtual > 0;
  const podeProxima = idxAtual >= 0 && etapas != null && idxAtual < etapas.length - 1;

  return (
    <section className="card p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-medium text-grafite-900">Esteira (Gupy)</h2>
        {temEtapas && (
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-soft text-xs"
              disabled={!podeAnterior || movendo}
              onClick={() => etapas && void mover(etapas[idxAtual - 1])}
            >
              ← Anterior
            </button>
            <button
              type="button"
              className="btn-primary text-xs"
              disabled={!podeProxima || movendo}
              onClick={() => etapas && void mover(etapas[idxAtual + 1])}
            >
              Próxima →
            </button>
          </div>
        )}
      </div>

      {erro && (
        <div className="badge-red mb-3 px-3 py-2 w-full justify-start">{erro}</div>
      )}

      {etapas === null ? (
        <p className="text-sm text-grafite-400">Carregando etapas…</p>
      ) : etapas.length === 0 ? (
        <p className="text-sm text-grafite-400">
          Nenhuma etapa encontrada para esta vaga na Gupy.
        </p>
      ) : (
        <>
          {idxAtual < 0 && (
            <p className="text-xs text-grafite-400 mb-2">
              Etapa atual do candidato {etapaAtual ? `("${etapaAtual}") ` : ''}
              não corresponde às etapas da vaga — escolha uma etapa abaixo.
            </p>
          )}
          <ol className="space-y-1">
            {etapas.map((e, i) => {
              const atual = i === idxAtual;
              return (
                <li
                  key={e.id}
                  className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm ${
                    atual
                      ? 'bg-unifique-50 border border-unifique-200 dark:bg-unifique-500/15 dark:border-unifique-500/30'
                      : 'border border-transparent'
                  }`}
                >
                  <span className="w-5 tabular-nums text-grafite-400">
                    {i + 1}
                  </span>
                  <span
                    className={
                      atual
                        ? 'font-medium text-unifique-700'
                        : 'text-grafite-700'
                    }
                  >
                    {e.name}
                  </span>
                  {atual && <span className="badge-green ml-1">atual</span>}
                  {!atual && (
                    <button
                      type="button"
                      className="ml-auto text-xs text-unifique-700 hover:underline disabled:opacity-50"
                      disabled={movendo}
                      onClick={() => void mover(e)}
                    >
                      Mover aqui
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
        </>
      )}

      <div className="mt-3 border-t border-grafite-100 pt-3">
        {!reprovando ? (
          <button
            type="button"
            className="text-xs text-red-600 hover:underline disabled:opacity-50"
            disabled={movendo || !temEtapas}
            onClick={() => setReprovando(true)}
          >
            Reprovar candidato
          </button>
        ) : (
          <div className="space-y-2">
            <textarea
              className="w-full border border-grafite-200 rounded-md px-2 py-1.5 text-sm"
              rows={2}
              placeholder="Motivo da reprovação (opcional)"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
            />
            <div className="flex gap-2">
              <button
                type="button"
                className="btn text-xs bg-red-600 text-[#fff] hover:bg-red-700"
                disabled={movendo}
                onClick={() => void reprovar()}
              >
                {movendo ? 'Reprovando…' : 'Confirmar reprovação'}
              </button>
              <button
                type="button"
                className="btn-soft text-xs"
                disabled={movendo}
                onClick={() => {
                  setReprovando(false);
                  setMotivo('');
                }}
              >
                Cancelar
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
