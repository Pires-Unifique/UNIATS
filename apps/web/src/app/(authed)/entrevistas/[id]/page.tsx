'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { PageHeader } from '@/components/PageHeader';
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
  const [gerandoPerguntas, setGerandoPerguntas] = useState(false);
  // Bloco de anotações do recrutador (persistido em parecer_final).
  const [anotacoes, setAnotacoes] = useState('');
  const [salvandoNota, setSalvandoNota] = useState(false);
  const [notaStatus, setNotaStatus] = useState<string | null>(null);

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

  // Sincroniza o bloco de anotações com o que veio do servidor ao carregar.
  useEffect(() => {
    setAnotacoes(e?.parecer_final ?? '');
  }, [e?.parecer_final]);

  async function salvarAnotacoes() {
    if (salvandoNota) return;
    setSalvandoNota(true);
    setNotaStatus(null);
    try {
      await api(`/api/entrevistas/${id}/anotacoes`, {
        method: 'POST',
        body: { anotacoes },
      });
      setNotaStatus('Anotações salvas.');
    } catch (err) {
      setNotaStatus(
        err instanceof ApiError ? err.message : 'Falha ao salvar anotações.',
      );
    } finally {
      setSalvandoNota(false);
    }
  }

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

  async function gerarPerguntas() {
    const ent = e;
    if (gerandoPerguntas || !ent) return;
    setGerandoPerguntas(true);
    setAcao('Gerando perguntas com IA… isso pode levar alguns segundos.');
    try {
      const r = await api<{ perguntas: PerguntaDTO[] }>('/api/perguntas/gerar', {
        method: 'POST',
        body: {
          candidaturaId: ent.candidatura_id,
          entrevistaId: id,
          substituir: true,
        },
      });
      // Recarrega só a lista de perguntas (evita o flicker de recarregar a página toda).
      const lista = await api<PerguntaDTO[]>('/api/perguntas', {
        query: { entrevistaId: id },
      }).catch(() => [] as PerguntaDTO[]);
      setPerguntas(lista);
      setAcao(`${r.perguntas.length} pergunta(s) gerada(s) para esta entrevista.`);
    } catch (err) {
      setAcao(
        err instanceof ApiError ? err.message : 'Falha ao gerar perguntas.',
      );
    } finally {
      setGerandoPerguntas(false);
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
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-medium text-grafite-900">
              Perguntas pré-geradas
            </h2>
            <button
              type="button"
              className="btn-secondary text-xs"
              disabled={gerandoPerguntas}
              onClick={() => void gerarPerguntas()}
            >
              {gerandoPerguntas
                ? 'Gerando…'
                : perguntas.length === 0
                  ? 'Gerar perguntas'
                  : 'Gerar novamente'}
            </button>
          </div>
          {perguntas.length === 0 ? (
            <p className="text-sm text-grafite-400">
              Nenhuma pergunta gerada ainda. Clique em &ldquo;Gerar
              perguntas&rdquo; para criá-las com IA a partir do currículo do
              candidato e dos requisitos da vaga.
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

        {/* Anotações do recrutador (bloco de notas da entrevista) */}
        <section className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-medium text-grafite-900">
              Anotações da entrevista
            </h2>
            {notaStatus && (
              <span className="text-xs text-grafite-400">{notaStatus}</span>
            )}
          </div>
          <textarea
            className="w-full min-h-[200px] resize-y rounded-md border border-grafite-200 p-3 text-sm text-grafite-800 focus:border-unifique-500 focus:outline-none focus:ring-1 focus:ring-unifique-500"
            placeholder="Anote aqui os pontos da entrevista: respostas que se destacaram, dúvidas, pontos de atenção, próximos passos…"
            value={anotacoes}
            onChange={(ev) => {
              setAnotacoes(ev.target.value);
              setNotaStatus(null);
            }}
            onBlur={() => void salvarAnotacoes()}
          />
          <div className="mt-2 flex items-center justify-between">
            <p className="text-xs text-grafite-400">
              Salva automaticamente ao clicar fora do campo.
            </p>
            <button
              type="button"
              className="btn-secondary text-xs"
              disabled={salvandoNota}
              onClick={() => void salvarAnotacoes()}
            >
              {salvandoNota ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
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
                <p className="text-sm text-grafite-700 whitespace-pre-line">
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
