'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { PageHeader } from '@/components/PageHeader';
import { StatusBadge } from '@/components/StatusBadge';
import { api, ApiError } from '@/lib/api';
import { formatarDataHora } from '@/lib/format';

interface PerguntaDTO {
  id: string;
  ordem: number;
  pergunta: string;
  objetivo: string | null;
  competencia: string | null;
  dificuldade: 'baixa' | 'media' | 'alta' | null;
  resposta_esperada: string | null;
}

interface EntrevistaDetalhe {
  id: string;
  candidatura_id: string;
  agendada_para: string;
  duracao_estimada_min: number;
  meet_url: string | null;
  status: string;
  bot_status: string | null;
  iniciada_em: string | null;
  finalizada_em: string | null;
  parecer_final: string | null;
  parecer_aprovado_em: string | null;
  transcricao: {
    id: string;
    idioma: string;
    texto_completo: string;
    resumo: string | null;
    topicos: string[];
    criado_em: string;
  } | null;
  analise_voz: {
    sentimento_global: string | null;
    confianca_media: number | null;
    nervosismo_medio: number | null;
    entusiasmo_medio: number | null;
    hesitacao_count: number | null;
    observacoes_llm: string | null;
  } | null;
}

export default function EntrevistaPage({
  params,
}: {
  params: { id: string };
}) {
  const id = params.id;
  const [e, setE] = useState<EntrevistaDetalhe | null>(null);
  const [perguntas, setPerguntas] = useState<PerguntaDTO[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [acao, setAcao] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    setErro(null);
    setCarregando(true);
    try {
      const [det, listaPerguntas] = await Promise.all([
        api<EntrevistaDetalhe>(`/api/entrevistas/${id}`),
        api<PerguntaDTO[]>('/api/perguntas', {
          query: { entrevistaId: id },
        }).catch(() => [] as PerguntaDTO[]),
      ]);
      setE(det);
      setPerguntas(listaPerguntas);
    } catch (err) {
      if (err instanceof ApiError) setErro(err.message);
      else setErro('Falha ao carregar entrevista.');
    } finally {
      setCarregando(false);
    }
  }, [id]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function iniciarBot() {
    setAcao(null);
    try {
      await api(`/api/entrevistas/${id}/iniciar-bot`, { method: 'POST' });
      setAcao('Bot enfileirado — entra na sala em alguns segundos.');
    } catch (err) {
      setAcao(err instanceof ApiError ? err.message : 'Falha ao iniciar bot.');
    }
  }

  async function encerrar() {
    setAcao(null);
    try {
      await api(`/api/entrevistas/${id}/encerrar`, { method: 'POST' });
      setAcao('Encerramento solicitado.');
    } catch (err) {
      setAcao(err instanceof ApiError ? err.message : 'Falha ao encerrar.');
    }
  }

  if (carregando) {
    return <div className="text-sm text-grafite-400 p-4">Carregando…</div>;
  }
  if (erro) {
    return <div className="badge-red p-3">{erro}</div>;
  }
  if (!e) return null;

  return (
    <div>
      <PageHeader
        titulo={`Entrevista de ${formatarDataHora(e.agendada_para)}`}
        subtitulo={`Status: ${e.status} · Bot: ${e.bot_status ?? '—'}`}
        acoes={
          <>
            <Link
              href={`/candidaturas/${e.candidatura_id}`}
              className="btn-secondary"
            >
              ← Candidato
            </Link>
            {e.meet_url && (
              <a
                href={e.meet_url}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-secondary"
              >
                Abrir Meet
              </a>
            )}
            {e.status === 'AGENDADA' && (
              <button
                type="button"
                className="btn-primary"
                onClick={() => void iniciarBot()}
              >
                Iniciar bot
              </button>
            )}
            {e.status === 'EM_ANDAMENTO' && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => void encerrar()}
              >
                Encerrar bot
              </button>
            )}
          </>
        }
      />

      {acao && (
        <div className="badge-blue mb-4 px-3 py-2 w-full justify-start">{acao}</div>
      )}

      <div className="grid grid-cols-2 gap-4">
        {/* Perguntas pré-entrevista */}
        <section className="card p-5">
          <h2 className="font-medium text-grafite-900 mb-3">
            Perguntas pré-geradas
          </h2>
          {perguntas.length === 0 ? (
            <p className="text-sm text-grafite-400">
              Nenhuma pergunta gerada. Vá em &ldquo;Detalhe do candidato&rdquo; e clique em &ldquo;Gerar perguntas&rdquo;.
            </p>
          ) : (
            <ol className="space-y-3">
              {perguntas.map((p) => (
                <li key={p.id} className="border-l-2 border-unifique-500 pl-3">
                  <div className="flex items-baseline gap-2 mb-1">
                    <span className="text-xs text-grafite-400 tabular-nums">
                      #{p.ordem}
                    </span>
                    {p.competencia && (
                      <span className="badge-blue">{p.competencia}</span>
                    )}
                    {p.dificuldade && (
                      <span
                        className={
                          p.dificuldade === 'alta'
                            ? 'badge-red'
                            : p.dificuldade === 'media'
                              ? 'badge-yellow'
                              : 'badge-green'
                        }
                      >
                        {p.dificuldade}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-grafite-900">{p.pergunta}</p>
                  {p.objetivo && (
                    <p className="text-xs text-grafite-400 mt-1">
                      🎯 {p.objetivo}
                    </p>
                  )}
                  {p.resposta_esperada && (
                    <details className="text-xs text-grafite-400 mt-1">
                      <summary className="cursor-pointer">
                        Sinais a buscar
                      </summary>
                      <p className="mt-1">{p.resposta_esperada}</p>
                    </details>
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>

        {/* Análise de voz */}
        <section className="card p-5">
          <h2 className="font-medium text-grafite-900 mb-3">
            Tom de voz (descritivo)
          </h2>
          {!e.analise_voz ? (
            <p className="text-sm text-grafite-400">
              Análise ainda não disponível. Ela é gerada após a entrevista terminar
              e a transcrição ficar pronta.
            </p>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-3 mb-3">
                <Metric
                  label="Confiança"
                  v={e.analise_voz.confianca_media}
                />
                <Metric
                  label="Nervosismo"
                  v={e.analise_voz.nervosismo_medio}
                  invert
                />
                <Metric
                  label="Entusiasmo"
                  v={e.analise_voz.entusiasmo_medio}
                />
              </div>
              <p className="text-xs text-grafite-400 mb-2">
                Sentimento global:{' '}
                <StatusBadge status={e.analise_voz.sentimento_global ?? 'NEUTRO'} />
                {e.analise_voz.hesitacao_count != null && (
                  <span className="ml-2">
                    · {e.analise_voz.hesitacao_count} hesitações detectadas
                  </span>
                )}
              </p>
              {e.analise_voz.observacoes_llm && (
                <p className="text-sm text-grafite-700 whitespace-pre-line">
                  {e.analise_voz.observacoes_llm}
                </p>
              )}
              <p className="text-xs text-grafite-400 mt-3 italic">
                Lembrete LGPD: esta análise é descritiva, não decisória. Não usar como
                critério único de contratação.
              </p>
            </>
          )}
        </section>
      </div>

      {/* Transcrição */}
      <section className="card p-5 mt-4">
        <h2 className="font-medium text-grafite-900 mb-3">Transcrição</h2>
        {!e.transcricao ? (
          <p className="text-sm text-grafite-400">
            Transcrição ainda não disponível.
          </p>
        ) : (
          <div>
            <p className="text-xs text-grafite-400 mb-3">
              {e.transcricao.idioma} · gerada em{' '}
              {formatarDataHora(e.transcricao.criado_em)}
            </p>
            {e.transcricao.resumo && (
              <div className="mb-3 p-3 bg-grafite-50 rounded">
                <div className="text-xs uppercase text-grafite-400 mb-1">
                  Resumo
                </div>
                <p className="text-sm text-grafite-700">
                  {e.transcricao.resumo}
                </p>
              </div>
            )}
            <pre className="text-sm text-grafite-700 whitespace-pre-wrap font-sans max-h-96 overflow-y-auto">
              {e.transcricao.texto_completo}
            </pre>
          </div>
        )}
      </section>
    </div>
  );
}

function Metric({
  label,
  v,
  invert,
}: {
  label: string;
  v: number | null | undefined;
  invert?: boolean;
}) {
  const val = v == null ? null : v;
  const pct = val == null ? 0 : Math.round(val * 100);
  const cor =
    val == null
      ? 'bg-grafite-200'
      : invert
        ? pct > 60
          ? 'bg-red-500'
          : pct > 30
            ? 'bg-amber-500'
            : 'bg-emerald-500'
        : pct > 60
          ? 'bg-emerald-500'
          : pct > 30
            ? 'bg-amber-500'
            : 'bg-red-500';
  return (
    <div>
      <div className="text-xs text-grafite-400">{label}</div>
      <div className="text-lg font-semibold tabular-nums">
        {val == null ? '—' : `${pct}%`}
      </div>
      <div className="h-1.5 bg-grafite-100 rounded">
        <div className={`h-1.5 ${cor} rounded`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
