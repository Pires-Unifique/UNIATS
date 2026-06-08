'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { StatusBadge } from '@/components/StatusBadge';
import { api, ApiError } from '@/lib/api';
import { formatarData } from '@/lib/format';

interface VagaDetalhe {
  id: string;
  gupy_id: string;
  codigo: string | null;
  titulo: string;
  descricao: string | null;
  departamento: string | null;
  unidade: string | null;
  cidade: string | null;
  estado: string | null;
  tipo_contrato: string | null;
  remoto: boolean;
  status: string;
  data_publicacao: string | null;
  data_fechamento: string | null;
  requisitos_texto: string | null;
  recrutador: { nome: string; email: string } | null;
  gestor: { nome: string; email: string } | null;
  qtdCandidaturas: number;
}

interface CandidaturaItem {
  candidaturaId: string;
  candidatoNome: string;
  email: string | null;
  telefone: string | null;
  cidade: string | null;
  estado: string | null;
  status: string;
  etapaGupy: string | null;
  inscritoEm: string | null;
  anosExperiencia: number | null;
  temCurriculo: boolean;
  score: number | null;
  justificativa: string | null;
}

interface CandidaturasResponse {
  vaga: { id: string; titulo: string; gupyId: string };
  total: number;
  itens: CandidaturaItem[];
}

const STATUS_LABEL: Record<string, string> = {
  EM_ANALISE: 'Em análise',
  TRIAGEM_IA: 'Triagem IA',
  APROVADO_TRIAGEM: 'Aprovado triagem',
  ENTREVISTA_AGENDADA: 'Entrevista agendada',
  ENTREVISTA_REALIZADA: 'Entrevista realizada',
  APROVADO: 'Aprovado',
  REPROVADO: 'Reprovado',
  CONTRATADO: 'Contratado',
  DESISTENTE: 'Desistente',
};

export default function CandidatosVagaPage({
  params,
}: {
  params: { id: string };
}) {
  const vagaId = params.id;
  const [data, setData] = useState<CandidaturasResponse | null>(null);
  const [vaga, setVaga] = useState<VagaDetalhe | null>(null);
  const [busca, setBusca] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [sincronizando, setSincronizando] = useState(false);
  const [classificando, setClassificando] = useState(false);
  const [rerankeando, setRerankeando] = useState(false);
  const [avaliandoProximos, setAvaliandoProximos] = useState(false);
  const [pendentesLLM, setPendentesLLM] = useState<number | null>(null);
  // Por padrão, candidatos REPROVADOS e DESISTENTES são ignorados na classificação.
  const [incluirReprovados, setIncluirReprovados] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  // Tamanho do lote avaliado pelo Claude por vez (top-N e "próximos").
  const TOP_N = 10;

  // Detalhes da vaga: carregam uma vez (independem da busca).
  const carregarVaga = useCallback(async () => {
    try {
      const det = await api<VagaDetalhe>(`/api/vagas/${vagaId}`);
      setVaga(det);
    } catch {
      // Erro de candidaturas já é exibido; não duplicar mensagem aqui.
    }
    // Status vetorial (best-effort): mostra "Avaliar próximos" se já há pendentes.
    try {
      const st = await api<{ pendentesLLM: number }>(
        `/api/vagas/${vagaId}/vetorial/status`,
        { query: { incluirReprovados: incluirReprovados ? 'true' : undefined } },
      );
      setPendentesLLM(st.pendentesLLM);
    } catch {
      /* ignore */
    }
  }, [vagaId, incluirReprovados]);

  // Candidaturas: busca no servidor por nome (varre todos, não só os 200 exibidos).
  const carregarCandidaturas = useCallback(
    async (q: string) => {
      setCarregando(true);
      setErro(null);
      try {
        const resp = await api<CandidaturasResponse>(
          `/api/vagas/${vagaId}/candidaturas`,
          { query: { limite: 200, q: q.trim() || undefined } },
        );
        setData(resp);
      } catch (err) {
        if (err instanceof ApiError) setErro(err.message);
        else setErro('Falha ao carregar candidatos.');
        setData(null);
      } finally {
        setCarregando(false);
      }
    },
    [vagaId],
  );

  useEffect(() => {
    void carregarVaga();
  }, [carregarVaga]);

  // Debounce da busca (e carga inicial quando busca = '').
  useEffect(() => {
    const t = setTimeout(() => void carregarCandidaturas(busca), 300);
    return () => clearTimeout(t);
  }, [busca, carregarCandidaturas]);

  async function sincronizar() {
    if (!data?.vaga.gupyId) return;
    setSincronizando(true);
    setErro(null);
    setAviso(null);
    try {
      const r = await api<{ total: number }>(
        `/api/gupy/sync/vaga/${data.vaga.gupyId}/candidaturas`,
        { method: 'POST' },
      );
      setAviso(`${r.total} candidatura(s) sincronizada(s) da Gupy.`);
      await Promise.all([carregarCandidaturas(busca), carregarVaga()]);
    } catch (err) {
      if (err instanceof ApiError) setErro(err.message);
      else setErro('Falha ao sincronizar candidaturas.');
    } finally {
      setSincronizando(false);
    }
  }

  /**
   * Acompanha o progresso da classificação via polling do endpoint de status.
   * - modo 'claude' (LLM-only): a API marca `emAndamento`, então paramos quando ele zera.
   * - modo 'completo' (Voyage + Claude via fila): o `reranking` não seta `emAndamento`,
   *   então paramos quando todos foram pontuados ou quando o progresso estaciona
   *   (possível limite de requisições do Voyage).
   */
  async function acompanharProgresso(modo: 'claude' | 'completo') {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const label =
      modo === 'claude' ? 'Classificando com IA (Claude)' : 'Classificando (Voyage + Claude)';
    let anterior = -1;
    let semProgresso = 0;

    // Quantos ciclos de 4s sem nenhum novo score até considerar "travado".
    // O Voyage no tier gratuito limita a 3 req/min (~22s por embedding), então
    // um intervalo de 60s entre dois candidatos é NORMAL, não estagnação. Usamos
    // 3 min (45 × 4s) para evitar falso "pausado" enquanto a fila ainda progride.
    const MAX_CICLOS_SEM_PROGRESSO = 45;

    // ~12 min de janela (180 × 4s). Cada candidato leva alguns segundos.
    for (let i = 0; i < 180; i++) {
      await sleep(4000);
      const st = await api<{
        total: number;
        classificados: number;
        emAndamento: boolean;
      }>(`/api/vagas/${vagaId}/classificar/status`);
      await carregarCandidaturas(busca);

      const concluiuTudo = st.total > 0 && st.classificados >= st.total;

      if (modo === 'claude' && !st.emAndamento) {
        setAviso(
          `Classificação concluída: ${st.classificados}/${st.total} candidato(s) pontuado(s) pelo Claude.`,
        );
        return;
      }

      if (modo === 'completo') {
        if (concluiuTudo) {
          setAviso(
            `Classificação completa concluída: ${st.classificados}/${st.total} candidato(s) (Voyage + Claude).`,
          );
          return;
        }
        // Detecta estagnação (jobs travados por rate limit do Voyage, p.ex.).
        if (st.classificados === anterior) semProgresso++;
        else semProgresso = 0;
        anterior = st.classificados;
        if (semProgresso >= MAX_CICLOS_SEM_PROGRESSO) {
          setAviso(
            `Classificação em andamento em segundo plano (${st.classificados}/${st.total} concluído(s)). ` +
              'No plano gratuito do Voyage (3 req/min) cada candidato leva ~20s, então isso é normal. ' +
              'Os scores continuam sendo gerados — recarregue a página em alguns minutos para ver o resultado.',
          );
          return;
        }
      }

      setAviso(`${label}: ${st.classificados}/${st.total} candidato(s)…`);
    }
  }

  async function classificar() {
    setClassificando(true);
    setErro(null);
    setAviso(null);
    try {
      await api<{ iniciado: boolean; total: number; classificados: number }>(
        `/api/vagas/${vagaId}/classificar`,
        { method: 'POST' },
      );
      setAviso('Classificação iniciada — os scores aparecem conforme processam…');
      await acompanharProgresso('claude');
    } catch (err) {
      if (err instanceof ApiError) setErro(err.message);
      else setErro('Falha ao classificar candidatos.');
    } finally {
      setClassificando(false);
    }
  }

  /**
   * Fluxo "completo" (Voyage + Claude) com pré-filtro vetorial:
   *  1. Gera embeddings (Voyage) da vaga + CVs faltantes — barato.
   *  2. Avalia com Claude apenas os TOP_N candidatos mais próximos vetorialmente.
   * Se nenhum do top-N servir, use "Avaliar próximos" para descer na lista.
   */
  async function classificarCompleto() {
    setRerankeando(true);
    setErro(null);
    setAviso(null);
    try {
      // Fase 1 — embeddings EM LOTE. Em vagas grandes o Voyage (trial) pode
      // estourar o rate limit no meio; o backend salva o que embedou e retorna
      // `interrompido`. Repetimos até embedar tudo (cada chamada continua de onde
      // parou, pulando os já embedados).
      let embTotal = 0;
      for (let i = 0; i < 30; i++) {
        const prep = await api<{
          curriculos: number;
          restantes: number;
          interrompido: boolean;
        }>(`/api/vagas/${vagaId}/vetorial/preparar-lote`, {
          method: 'POST',
          body: { incluirReprovados },
        });
        embTotal += prep.curriculos;
        if (!prep.interrompido || prep.restantes <= 0) break;
        setAviso(
          `Gerando embeddings no Voyage… ${embTotal} prontos, ~${prep.restantes} restantes ` +
            '(plano trial é limitado — seguindo em lotes).',
        );
      }

      // Fase 2 — Claude apenas no top-N por similaridade vetorial
      setAviso(`Avaliando os ${TOP_N} mais aderentes com o Claude…`);
      const r = await api<{
        avaliadosAgora: number;
        pendentesLLM: number;
        embedados: number;
      }>(`/api/vagas/${vagaId}/vetorial/avaliar-proximos`, {
        method: 'POST',
        body: { n: TOP_N, incluirReprovados },
      });
      await carregarCandidaturas(busca);
      setPendentesLLM(r.pendentesLLM);
      setAviso(
        `Top ${r.avaliadosAgora} avaliados (Voyage + Claude). ` +
          (r.pendentesLLM > 0
            ? `${r.pendentesLLM} candidato(s) restante(s) — use "Avaliar próximos" se nenhum servir.`
            : 'Todos os candidatos embedados já foram avaliados.'),
      );
    } catch (err) {
      if (err instanceof ApiError) setErro(err.message);
      else setErro('Falha na classificação completa.');
    } finally {
      setRerankeando(false);
    }
  }

  /** Avalia com Claude o PRÓXIMO lote (top-N seguinte por similaridade vetorial). */
  async function avaliarProximos() {
    setAvaliandoProximos(true);
    setErro(null);
    setAviso(null);
    try {
      const r = await api<{
        avaliadosAgora: number;
        pendentesLLM: number;
      }>(`/api/vagas/${vagaId}/vetorial/avaliar-proximos`, {
        method: 'POST',
        body: { n: TOP_N, incluirReprovados },
      });
      await carregarCandidaturas(busca);
      setPendentesLLM(r.pendentesLLM);
      if (r.avaliadosAgora === 0) {
        setAviso(
          'Não há mais candidatos para avaliar — todos os embedados já foram avaliados pelo Claude.',
        );
      } else {
        setAviso(
          `+${r.avaliadosAgora} candidato(s) avaliado(s) (Voyage + Claude). ${r.pendentesLLM} restante(s).`,
        );
      }
    } catch (err) {
      if (err instanceof ApiError) setErro(err.message);
      else setErro('Falha ao avaliar os próximos candidatos.');
    } finally {
      setAvaliandoProximos(false);
    }
  }

  const temCandidatos = (data?.itens.length ?? 0) > 0;

  return (
    <div>
      <PageHeader
        titulo={vaga ? `Candidatos — ${vaga.titulo}` : 'Candidatos'}
        subtitulo={
          data
            ? busca.trim()
              ? `${data.total} candidato(s) encontrado(s) para “${busca.trim()}”.`
              : `${data.total} candidato(s) nesta vaga.`
            : ''
        }
        acoes={
          <>
            <Link href="/vagas" className="btn-secondary">
              ← Vagas
            </Link>
            <button
              type="button"
              className="btn-secondary"
              disabled={sincronizando || classificando || rerankeando || avaliandoProximos || !data}
              onClick={() => void sincronizar()}
            >
              {sincronizando ? 'Sincronizando…' : 'Sincronizar candidaturas'}
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={classificando || rerankeando || avaliandoProximos || sincronizando || !temCandidatos}
              onClick={() => void classificar()}
              title="Pontua só com o Claude, em todos os candidatos (sem similaridade vetorial)."
            >
              {classificando ? 'Classificando…' : 'Classificar (Claude)'}
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={rerankeando || classificando || avaliandoProximos || sincronizando || !temCandidatos}
              onClick={() => void classificarCompleto()}
              title={`Gera embeddings no Voyage e avalia com Claude só os ${TOP_N} mais aderentes (score: 40% vetorial + 60% LLM).`}
            >
              {rerankeando
                ? 'Classificando…'
                : `Classificação completa (top ${TOP_N})`}
            </button>
            {pendentesLLM != null && pendentesLLM > 0 && (
              <button
                type="button"
                className="btn-secondary"
                disabled={avaliandoProximos || rerankeando || classificando || sincronizando}
                onClick={() => void avaliarProximos()}
                title="Avalia com Claude o próximo lote de candidatos por similaridade vetorial."
              >
                {avaliandoProximos
                  ? 'Avaliando…'
                  : `Avaliar próximos ${TOP_N} (${pendentesLLM} restantes)`}
              </button>
            )}
            <label
              className="flex items-center gap-1.5 text-xs text-grafite-600 cursor-pointer select-none"
              title="Por padrão, candidatos reprovados e desistentes são ignorados na classificação."
            >
              <input
                type="checkbox"
                checked={incluirReprovados}
                disabled={classificando || rerankeando || avaliandoProximos || sincronizando}
                onChange={(e) => setIncluirReprovados(e.target.checked)}
              />
              Incluir reprovados/desistentes
            </label>
          </>
        }
      />

      {aviso && (
        <div className="badge-green mb-4 w-full justify-start px-3 py-2">
          {aviso}
        </div>
      )}
      {erro && (
        <div className="badge-red mb-4 w-full justify-start px-3 py-2">
          {erro}
        </div>
      )}

      {vaga && <VagaDetailCard vaga={vaga} />}

      {(vaga || data) && (
        <div className="card p-4 mb-4 flex gap-3 items-center">
          <input
            className="flex-1 border border-grafite-200 rounded-md px-3 py-2 text-sm"
            type="search"
            placeholder="Buscar por nome, e-mail ou cidade…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
          {carregando && data && (
            <span className="text-xs text-grafite-400">Buscando…</span>
          )}
        </div>
      )}

      {data === null && carregando ? (
        <div className="text-sm text-grafite-400 p-4">Carregando…</div>
      ) : !data || data.itens.length === 0 ? (
        <EmptyState
          titulo={
            busca.trim() ? 'Nenhum candidato encontrado' : 'Nenhum candidato ainda'
          }
          descricao={
            busca.trim()
              ? `Nenhum candidato corresponde a “${busca.trim()}”. Tente outro nome, e-mail ou cidade.`
              : "Clique em 'Sincronizar candidaturas' para importar os candidatos desta vaga a partir da Gupy."
          }
        />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-grafite-50 text-grafite-600">
              <tr>
                <Th>#</Th>
                <Th>Score IA</Th>
                <Th>Candidato</Th>
                <Th>Contato</Th>
                <Th>Local</Th>
                <Th>Etapa (Gupy)</Th>
                <Th>Exp.</Th>
                <Th>Justificativa</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {data.itens.map((it, idx) => (
                <tr
                  key={it.candidaturaId}
                  className="border-t border-grafite-100 hover:bg-grafite-50"
                >
                  <Td className="text-grafite-400 tabular-nums">{idx + 1}</Td>
                  <Td>
                    {it.score != null ? (
                      <span
                        className={`inline-flex min-w-[2.5rem] justify-center rounded px-2 py-0.5 text-sm font-semibold tabular-nums ${
                          it.score >= 70
                            ? 'bg-green-100 text-green-800'
                            : it.score >= 40
                              ? 'bg-amber-100 text-amber-800'
                              : 'bg-grafite-100 text-grafite-700'
                        }`}
                      >
                        {Math.round(it.score)}
                      </span>
                    ) : (
                      <span className="text-grafite-400 text-xs">—</span>
                    )}
                  </Td>
                  <Td>
                    <div className="font-medium text-grafite-900">
                      {it.candidatoNome}
                    </div>
                    <div className="text-xs text-grafite-400">
                      {STATUS_LABEL[it.status] ?? it.status}
                    </div>
                  </Td>
                  <Td className="text-grafite-600 text-xs">
                    <div>{it.email ?? '—'}</div>
                    <div>{it.telefone ?? ''}</div>
                  </Td>
                  <Td className="text-grafite-600">
                    {[it.cidade, it.estado].filter(Boolean).join(' / ') || '—'}
                  </Td>
                  <Td className="text-grafite-600">{it.etapaGupy ?? '—'}</Td>
                  <Td className="tabular-nums text-grafite-600">
                    {it.anosExperiencia != null
                      ? `${it.anosExperiencia} a`
                      : '—'}
                  </Td>
                  <Td className="max-w-md text-grafite-600 text-xs">
                    {it.justificativa
                      ? it.justificativa.length > 180
                        ? `${it.justificativa.slice(0, 180)}…`
                        : it.justificativa
                      : '—'}
                  </Td>
                  <Td className="text-right">
                    <Link
                      href={`/candidaturas/${it.candidaturaId}`}
                      className="text-unifique-700 hover:underline text-xs"
                    >
                      Detalhe →
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

function VagaDetailCard({ vaga }: { vaga: VagaDetalhe }) {
  const local = vaga.remoto
    ? 'Remoto'
    : [vaga.cidade, vaga.estado].filter(Boolean).join(' / ') || '—';

  return (
    <div className="card p-5 mb-4">
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <StatusBadge status={vaga.status} />
        {vaga.codigo && (
          <span className="text-xs text-grafite-400">Código {vaga.codigo}</span>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-4">
        <Meta label="Departamento" valor={vaga.departamento} />
        <Meta label="Unidade" valor={vaga.unidade} />
        <Meta label="Local" valor={local} />
        <Meta label="Tipo de contrato" valor={vaga.tipo_contrato} />
        <Meta label="Publicada" valor={formatarData(vaga.data_publicacao)} />
        <Meta label="Fechamento" valor={formatarData(vaga.data_fechamento)} />
        <Meta label="Recrutador" valor={vaga.recrutador?.nome ?? null} />
        <Meta label="Gestor" valor={vaga.gestor?.nome ?? null} />
        <Meta label="Candidaturas" valor={String(vaga.qtdCandidaturas)} />
      </dl>

      {vaga.descricao && (
        <ColapsavelTexto titulo="Sobre a vaga" texto={vaga.descricao} />
      )}
      {vaga.requisitos_texto && (
        <ColapsavelTexto titulo="Requisitos" texto={vaga.requisitos_texto} />
      )}
    </div>
  );
}

function Meta({ label, valor }: { label: string; valor: string | null }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-grafite-400">{label}</dt>
      <dd className="text-sm text-grafite-900 mt-0.5">{valor || '—'}</dd>
    </div>
  );
}

/** Bloco de texto longo (descrição/requisitos) com expandir/recolher. */
function ColapsavelTexto({ titulo, texto }: { titulo: string; texto: string }) {
  const [aberto, setAberto] = useState(false);
  const longo = texto.length > 320;
  const exibido = aberto || !longo ? texto : `${texto.slice(0, 320)}…`;

  return (
    <div className="mt-5 border-t border-grafite-100 pt-4">
      <h3 className="text-sm font-semibold text-grafite-900 mb-1.5">{titulo}</h3>
      <p className="text-sm text-grafite-600 whitespace-pre-wrap leading-relaxed">
        {exibido}
      </p>
      {longo && (
        <button
          type="button"
          className="mt-1.5 text-xs font-medium text-unifique-700 hover:underline"
          onClick={() => setAberto((v) => !v)}
        >
          {aberto ? 'Ver menos' : 'Ver mais'}
        </button>
      )}
    </div>
  );
}

function Th({ children }: { children?: React.ReactNode }) {
  return (
    <th className="text-left font-medium px-4 py-2 text-xs uppercase tracking-wide">
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
  return <td className={`px-4 py-3 align-top ${className ?? ''}`}>{children}</td>;
}
