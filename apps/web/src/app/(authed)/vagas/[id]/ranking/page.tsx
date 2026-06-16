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

type AbaId = 'candidatos' | 'reprovados' | 'desistentes';

const ABAS: Array<{ id: AbaId; label: string }> = [
  { id: 'candidatos', label: 'Candidatos' },
  { id: 'reprovados', label: 'Reprovados' },
  { id: 'desistentes', label: 'Desistentes' },
];

// Status considerados "descartados" — separados nas abas Reprovados/Desistentes.
const STATUS_DESCARTADOS = ['REPROVADO', 'DESISTENTE'];

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
  const [rerankeando, setRerankeando] = useState(false);
  const [pendentesLLM, setPendentesLLM] = useState<number | null>(null);
  // Inclusão de REPROVADOS/DESISTENTES na classificação. Não é mais um checkbox:
  // é definida pela ação escolhida (botão principal = só ativos; opção do menu
  // suspenso = inclui descartados). Persistida para reaproveitar em "Avaliar próximos".
  const [incluirReprovados, setIncluirReprovados] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  // Aba ativa da lista de candidaturas.
  const [aba, setAba] = useState<AbaId>('candidatos');
  // Menu suspenso (setinha) do botão de classificação completa.
  const [menuClassificar, setMenuClassificar] = useState(false);

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
          {
            query: {
              limite: 200,
              q: q.trim() || undefined,
              // Carrega todos (inclui descartados) — a separação por aba
              // (Candidatos / Reprovados / Desistentes) é feita no cliente.
              incluirReprovados: 'true',
            },
          },
        );
        setData(resp);
      } catch (err) {
        if (err instanceof ApiError) setErro(err.message);
        else setErro('Não conseguimos carregar os candidatos. Tente de novo.');
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
      setAviso(`${r.total} candidato(s) trazido(s) da Gupy.`);
      await Promise.all([carregarCandidaturas(busca), carregarVaga()]);
    } catch (err) {
      if (err instanceof ApiError) setErro(err.message);
      else setErro('Não conseguimos trazer os candidatos da Gupy. Tente de novo.');
    } finally {
      setSincronizando(false);
    }
  }

  /**
   * Fluxo "completo" (Voyage + Claude) com pré-filtro vetorial:
   *  1. Gera embeddings (Voyage) da vaga + CVs faltantes — barato.
   *  2. Avalia com Claude apenas os TOP_N candidatos mais próximos vetorialmente.
   * Se nenhum do top-N servir, use "Avaliar próximos" para descer na lista.
   *
   * @param incluir Quando true, considera também REPROVADOS/DESISTENTES
   *   (acionado pela opção "Classificar reprovados/desistentes" do menu).
   */
  async function classificarCompleto(incluir: boolean) {
    setMenuClassificar(false);
    setIncluirReprovados(incluir);
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
          body: { incluirReprovados: incluir },
        });
        embTotal += prep.curriculos;
        if (!prep.interrompido || prep.restantes <= 0) break;
        setAviso(
          `Passo 1 de 2: lendo os currículos… ${embTotal} já lidos, ~${prep.restantes} faltando. ` +
            'Fazemos por partes, então pode levar alguns minutos.',
        );
      }

      // Fase 2 — Claude apenas no top-N por similaridade vetorial
      setAviso(`Passo 2 de 2: avaliando os ${TOP_N} currículos mais parecidos com a vaga…`);
      const r = await api<{
        avaliadosAgora: number;
        pendentesLLM: number;
        embedados: number;
      }>(`/api/vagas/${vagaId}/vetorial/avaliar-proximos`, {
        method: 'POST',
        body: { n: TOP_N, incluirReprovados: incluir },
      });
      await carregarCandidaturas(busca);
      setPendentesLLM(r.pendentesLLM);
      if (r.avaliadosAgora === 0 && r.embedados === 0) {
        // Nada avaliado E nenhum CV embedado → o passo vetorial (Voyage) não
        // produziu vetores. O fluxo completo depende deles; oriente a usar o
        // caminho que NÃO depende de embeddings.
        setAviso(null);
        setErro(
          'Nenhum currículo pôde ser lido para comparação (etapa de embeddings vazia — ' +
            'verifique a chave da Voyage). Use “Avaliar quem está sem nota”, que avalia ' +
            'direto com a IA sem depender dessa etapa.',
        );
      } else if (r.avaliadosAgora === 0) {
        setAviso('Todos os currículos já foram avaliados — não há mais nenhum sem nota.');
      } else {
        setAviso(
          `Pronto! ${r.avaliadosAgora} currículo(s) avaliado(s) e com nota. ` +
            (r.pendentesLLM > 0
              ? `Ainda faltam ${r.pendentesLLM} candidato(s) — clique em "Continuar avaliação" para seguir.`
              : 'Todos os currículos já foram avaliados.'),
        );
      }
    } catch (err) {
      if (err instanceof ApiError) setErro(err.message);
      else setErro('Não conseguimos avaliar os currículos agora. Tente de novo.');
    } finally {
      setRerankeando(false);
    }
  }

  /**
   * Reavalia (via IA) APENAS os currículos que estão SEM NOTA na lista — ou seja,
   * sem score CONSOLIDADO. Usa o classificador direto do Claude (não depende de
   * embedding), então cobre todos os pendentes. Útil para destravar quem ficou
   * sem nota por algum motivo, sem reavaliar quem já tem.
   */
  async function avaliarSemNota() {
    setMenuClassificar(false);
    setRerankeando(true);
    setErro(null);
    setAviso('Procurando currículos sem nota e reavaliando com IA…');
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    try {
      await api(`/api/vagas/${vagaId}/classificar`, {
        method: 'POST',
        body: { somentePendentes: true },
      });
      for (let i = 0; i < 300; i++) {
        await sleep(3000);
        const st = await api<{
          total: number;
          classificados: number;
          emAndamento: boolean;
          erros: number;
          ultimoErro: string | null;
        }>(`/api/vagas/${vagaId}/classificar/status`);
        await carregarCandidaturas(busca);
        if (!st.emAndamento) {
          // Houve falhas na avaliação (Claude indisponível, chave/modelo/TLS):
          // mostramos o motivo em vez de fingir sucesso — senão o operador só vê
          // "sem nota" sem saber o porquê.
          if (st.erros && st.erros !== 0) {
            setAviso(null);
            setErro(
              `Não foi possível avaliar com IA. ${st.classificados}/${st.total} com nota. ` +
                `Motivo: ${st.ultimoErro ?? 'erro desconhecido'}.`,
            );
          } else {
            setAviso(
              `Pronto! ${st.classificados}/${st.total} currículo(s) com nota.`,
            );
          }
          break;
        }
        setAviso(
          `Reavaliando quem estava sem nota… ${st.classificados}/${st.total} com nota.`,
        );
      }
    } catch (err) {
      if (err instanceof ApiError) setErro(err.message);
      else setErro('Não conseguimos reavaliar agora. Tente de novo.');
    } finally {
      setRerankeando(false);
    }
  }

  const temCandidatos = (data?.itens.length ?? 0) > 0;

  // Separa as candidaturas carregadas (todas) por aba, no cliente.
  const itensTodos = data?.itens ?? [];
  const grupos: Record<AbaId, CandidaturaItem[]> = {
    candidatos: itensTodos.filter((i) => !STATUS_DESCARTADOS.includes(i.status)),
    reprovados: itensTodos.filter((i) => i.status === 'REPROVADO'),
    desistentes: itensTodos.filter((i) => i.status === 'DESISTENTE'),
  };
  const itensAba = grupos[aba];

  // Já houve ao menos uma avaliação? (algum candidato já tem nota.) Nesse caso o
  // botão principal vira "Continuar avaliação" — avalia os próximos sem nota,
  // sem repetir quem já foi avaliado.
  const jaAvaliou = itensTodos.some((i) => i.score != null);

  // Desabilita as ações de classificação enquanto qualquer fluxo está em curso.
  const classificacaoOcupada = rerankeando || sincronizando;

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
              disabled={classificacaoOcupada || !data}
              onClick={() => void sincronizar()}
            >
              {sincronizando ? 'Buscando…' : 'Buscar candidatos da Gupy'}
            </button>

            {/* Split button: classificação completa + menu (setinha) para incluir descartados */}
            <div className="relative inline-flex">
              <button
                type="button"
                className="btn-primary rounded-r-none"
                disabled={classificacaoOcupada || !temCandidatos}
                onClick={() => void classificarCompleto(false)}
                title={
                  jaAvaliou
                    ? `Avalia os próximos ${TOP_N} currículos que ainda não têm nota. Não repete quem já foi avaliado.`
                    : `Lê os currículos e avalia os ${TOP_N} mais parecidos com a vaga, dando uma nota a cada um. Não inclui reprovados nem desistentes.`
                }
              >
                {rerankeando
                  ? jaAvaliou
                    ? 'Avaliando…'
                    : 'Classificando…'
                  : jaAvaliou
                    ? pendentesLLM != null && pendentesLLM > 0
                      ? `Continuar avaliação (faltam ${pendentesLLM})`
                      : 'Continuar avaliação'
                    : `Classificação completa (top ${TOP_N})`}
              </button>
              <button
                type="button"
                className="btn-primary rounded-l-none border-l border-black/20 px-2"
                disabled={classificacaoOcupada || !temCandidatos}
                onClick={() => setMenuClassificar((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={menuClassificar}
                aria-label="Mais opções de avaliação"
                title="Mais opções de avaliação"
              >
                <span aria-hidden>▾</span>
              </button>
              {menuClassificar && (
                <>
                  {/* Backdrop para fechar ao clicar fora */}
                  <button
                    type="button"
                    aria-hidden
                    tabIndex={-1}
                    className="fixed inset-0 z-10 cursor-default"
                    onClick={() => setMenuClassificar(false)}
                  />
                  <div
                    role="menu"
                    className="card absolute right-0 top-full z-20 mt-1 w-64 p-1"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      className="btn-ghost w-full justify-start text-sm"
                      disabled={classificacaoOcupada || !temCandidatos}
                      onClick={() => void classificarCompleto(true)}
                      title="Faz a mesma avaliação, mas considerando também os reprovados e desistentes."
                    >
                      Classificar reprovados/desistentes
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="btn-ghost w-full justify-start text-sm"
                      disabled={classificacaoOcupada || !temCandidatos}
                      onClick={() => void avaliarSemNota()}
                      title="Detecta os currículos que estão sem nota e reavalia só esses com IA."
                    >
                      Avaliar quem está sem nota
                    </button>
                  </div>
                </>
              )}
            </div>
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
              : "Clique em 'Buscar candidatos da Gupy' para trazer os candidatos desta vaga."
          }
        />
      ) : (
        <>
          {/* Abas: separa candidatos ativos dos reprovados e desistentes */}
          <div className="mb-3 flex gap-1 border-b border-grafite-100">
            {ABAS.map((t) => {
              const ativa = aba === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setAba(t.id)}
                  className={
                    '-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ' +
                    (ativa
                      ? 'border-unifique-600 text-unifique-700 dark:border-unifique-400 dark:text-unifique-400'
                      : 'border-transparent text-grafite-400 hover:text-grafite-600')
                  }
                >
                  {t.label}
                  <span className="ml-1.5 text-xs tabular-nums text-grafite-400">
                    {grupos[t.id].length}
                  </span>
                </button>
              );
            })}
          </div>

          {itensAba.length === 0 ? (
            <div className="card p-6 text-sm text-grafite-400">
              {aba === 'candidatos'
                ? 'Nenhum candidato ativo nesta vaga.'
                : aba === 'reprovados'
                  ? 'Nenhum candidato reprovado.'
                  : 'Nenhum candidato desistente.'}
            </div>
          ) : (
            <div className="card overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-grafite-50 text-grafite-600">
              <tr>
                <Th>#</Th>
                <Th>Nota IA</Th>
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
              {itensAba.map((it, idx) => (
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
                    ) : it.temCurriculo ? (
                      <span
                        className="badge-yellow text-xs"
                        title="Tem currículo, mas ainda sem nota da IA. Use 'Avaliar quem está sem nota'."
                      >
                        sem nota
                      </span>
                    ) : (
                      <span
                        className="badge-gray text-xs"
                        title="Sem currículo processado — a IA não tem o que avaliar. Importe/reprocesse o currículo (sincronizar Gupy)."
                      >
                        sem currículo
                      </span>
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
        </>
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
