'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { PageHeader } from '@/components/PageHeader';
import { api, ApiError } from '@/lib/api';
import { formatarDataHora } from '@/lib/format';

interface TranscricaoSegmento {
  inicio_ms?: number | null;
  fim_ms?: number | null;
  falante?: string | null;
  texto: string;
}

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
    segmentos?: TranscricaoSegmento[] | null;
    resumo: string | null;
    topicos: string[];
    criado_em: string;
    /** Versão reconciliada pelos 2 motores (Teams + Whisper) via Claude. */
    revisado?: boolean;
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
              className="btn-soft"
            >
              ← Candidato
            </Link>
            {e.meet_url && (
              <a
                href={e.meet_url}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-soft"
              >
                Abrir Meet
              </a>
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
              className="btn-soft text-xs"
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
              className="btn-soft text-xs"
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
              {e.transcricao.revisado && (
                <span
                  className="badge-blue ml-2"
                  title="Reconciliada por 2 motores (legenda do Teams + Whisper) via IA, corrigindo alucinações"
                >
                  ✨ versão revisada
                </span>
              )}
            </p>

            {/* Resumo — destaque */}
            {e.transcricao.resumo && (
              <div className="mb-4 flex gap-3 rounded-lg bg-unifique-50 dark:bg-unifique-500/10 p-4">
                <div className="w-1 shrink-0 rounded bg-unifique-500 dark:bg-unifique-400" aria-hidden />
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span aria-hidden>📝</span>
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-unifique-700 dark:text-unifique-300">
                      Resumo da entrevista
                    </h3>
                  </div>
                  <p className="text-base text-grafite-800 leading-relaxed whitespace-pre-line">
                    {e.transcricao.resumo}
                  </p>
                  {e.transcricao.topicos?.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {e.transcricao.topicos.map((t, i) => (
                        <span key={i} className="badge-blue">
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Falas separadas por participante (nomes coloridos) */}
            <TranscricaoFalas transcricao={e.transcricao} />

            {/* Texto cru, recolhível (backup) */}
            <details className="mt-4">
              <summary className="text-xs text-grafite-400 cursor-pointer hover:text-grafite-600">
                Ver transcrição completa (texto cru)
              </summary>
              <pre className="mt-2 text-sm text-grafite-700 whitespace-pre-wrap font-sans max-h-96 overflow-y-auto">
                {e.transcricao.texto_completo}
              </pre>
            </details>
          </div>
        )}
      </section>
    </div>
  );
}

// ---------------- Transcrição: falas separadas por participante ----------------

interface Turno {
  falante: string | null;
  texto: string;
  inicio_ms?: number | null;
}

// Paleta de cores por falante (Tailwind padrão → funciona nos dois temas).
const CORES_FALANTE = [
  { nome: 'text-blue-600 dark:text-blue-400', borda: 'border-blue-400 dark:border-blue-500' },
  { nome: 'text-emerald-600 dark:text-emerald-400', borda: 'border-emerald-400 dark:border-emerald-500' },
  { nome: 'text-violet-600 dark:text-violet-400', borda: 'border-violet-400 dark:border-violet-500' },
  { nome: 'text-amber-600 dark:text-amber-400', borda: 'border-amber-400 dark:border-amber-500' },
  { nome: 'text-rose-600 dark:text-rose-400', borda: 'border-rose-400 dark:border-rose-500' },
  { nome: 'text-cyan-600 dark:text-cyan-400', borda: 'border-cyan-400 dark:border-cyan-500' },
];
const COR_SEM_FALANTE = {
  nome: 'text-grafite-500',
  borda: 'border-grafite-200',
};

function mmss(ms?: number | null): string | null {
  if (ms == null || !Number.isFinite(ms)) return null;
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Quebra o `texto_completo` ("Falante: fala" por linha) em segmentos. */
function parsearTextoCompleto(txt: string): Turno[] {
  const linhas = (txt ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const out: Turno[] = [];
  for (const l of linhas) {
    const m = l.match(/^([\p{L}][\p{L}\s.'-]{0,38}):\s+(.+)$/u);
    if (m) {
      out.push({ falante: m[1].trim(), texto: m[2].trim() });
    } else if (out.length > 0) {
      out[out.length - 1].texto += ' ' + l;
    } else {
      out.push({ falante: null, texto: l });
    }
  }
  return out;
}

/** Monta os turnos a partir dos segmentos (preferido) ou do texto cru. */
function construirTurnos(t: {
  segmentos?: TranscricaoSegmento[] | null;
  texto_completo: string;
}): Turno[] {
  const segs = Array.isArray(t.segmentos) ? t.segmentos : [];
  const base: Turno[] =
    segs.length > 0
      ? segs
          .filter((s) => s && typeof s.texto === 'string' && s.texto.trim())
          .map((s) => ({
            falante: (s.falante ?? '').trim() || null,
            texto: s.texto.trim(),
            inicio_ms: s.inicio_ms ?? null,
          }))
      : parsearTextoCompleto(t.texto_completo);

  // Junta falas consecutivas do mesmo participante.
  const turnos: Turno[] = [];
  for (const seg of base) {
    const ultimo = turnos[turnos.length - 1];
    if (ultimo && ultimo.falante === seg.falante) {
      ultimo.texto += ' ' + seg.texto;
    } else {
      turnos.push({ ...seg });
    }
  }
  return turnos;
}

function TranscricaoFalas({
  transcricao,
}: {
  transcricao: { segmentos?: TranscricaoSegmento[] | null; texto_completo: string };
}) {
  const turnos = construirTurnos(transcricao);
  if (turnos.length === 0) {
    return <p className="text-sm text-grafite-400">Sem falas para exibir.</p>;
  }

  // Cor por falante (ordem de aparição).
  const cores = new Map<string, (typeof CORES_FALANTE)[number]>();
  let i = 0;
  for (const t of turnos) {
    if (!t.falante) continue;
    if (!cores.has(t.falante)) {
      cores.set(t.falante, CORES_FALANTE[i % CORES_FALANTE.length]);
      i++;
    }
  }
  const participantes = [...cores.keys()];

  return (
    <div>
      {/* Legenda de participantes */}
      {participantes.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-3">
          {participantes.map((p) => (
            <span key={p} className="flex items-center gap-1.5 text-xs">
              <span className={`h-2 w-2 rounded-full ${cores.get(p)!.borda} border-2`} />
              <span className={`font-medium ${cores.get(p)!.nome}`}>{p}</span>
            </span>
          ))}
        </div>
      )}

      <div className="space-y-3 max-h-[32rem] overflow-y-auto pr-1">
        {turnos.map((t, idx) => {
          const cor = t.falante ? cores.get(t.falante)! : COR_SEM_FALANTE;
          const ts = mmss(t.inicio_ms);
          return (
            <div key={idx} className={`border-l-2 pl-3 ${cor.borda}`}>
              <div className="flex items-baseline gap-2">
                <span className={`text-sm font-semibold ${cor.nome}`}>
                  {t.falante ?? 'Participante'}
                </span>
                {ts && (
                  <span className="text-xs text-grafite-400 tabular-nums">{ts}</span>
                )}
              </div>
              <p className="text-sm text-grafite-700 leading-relaxed whitespace-pre-line">
                {t.texto}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
