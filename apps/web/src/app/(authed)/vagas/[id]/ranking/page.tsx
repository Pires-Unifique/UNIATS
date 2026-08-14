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
  /** Página pública da vaga no portal de carreiras da Gupy. */
  url_gupy: string | null;
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
  /** BANCO_TALENTOS = puxado pelo recrutador; não se inscreveu nesta vaga. */
  origem: 'GUPY' | 'BANCO_TALENTOS';
  motivoDesclassif: string | null;
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
  /** Contagem por etapa do funil (ativos), vinda do banco — alimenta as sub-abas. */
  resumoEtapas: Array<{ etapa: string | null; total: number }>;
}

/** Candidato do banco de talentos sugerido pela busca vetorial. */
interface TalentoSugerido {
  candidatoId: string;
  candidaturaPoolId: string;
  candidatoNome: string;
  email: string | null;
  telefone: string | null;
  cidade: string | null;
  estado: string | null;
  vagaPoolTitulo: string;
  inscritoEm: string | null;
  anosExperiencia: number | null;
  resumo: string | null;
  similaridade: number;
}

interface TalentosResponse {
  vaga: { id: string; titulo: string };
  /** true = a vaga ainda não tem embedding; rode a classificação antes. */
  vagaSemVetor: boolean;
  totalPool: number;
  /** Piso de aderência aplicado (alto de propósito). */
  minSimilaridade: number;
  /** Aderência do melhor que ficou ABAIXO do piso — null se todos passaram. */
  melhorDescartado: number | null;
  itens: TalentoSugerido[];
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

type AbaId = 'candidatos' | 'reprovados' | 'desistentes' | 'talentos';

const ABAS: Array<{ id: AbaId; label: string }> = [
  { id: 'candidatos', label: 'Candidatos' },
  { id: 'reprovados', label: 'Reprovados' },
  { id: 'desistentes', label: 'Desistentes' },
  { id: 'talentos', label: 'Indicados pela IA' },
];

// Status considerados "descartados" — separados nas abas Reprovados/Desistentes.
const STATUS_DESCARTADOS = ['REPROVADO', 'DESISTENTE'];

// Sub-aba de etapa: 'todos' = sem filtro; SEM_ETAPA casa com etapa_gupy NULL
// (mesmo sentinela aceito pelo backend em ?etapa=).
const TODAS_ETAPAS = '__todas__';
const SEM_ETAPA = '__sem_etapa__';

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
  // Sub-aba de ETAPA do funil (só na aba "Candidatos"). O filtro é aplicado no
  // SERVIDOR — em vaga grande a página de 200 não contém todas as etapas, então
  // filtrar no cliente esconderia candidatos.
  const [etapaSel, setEtapaSel] = useState<string>(TODAS_ETAPAS);
  // Ordem das etapas conforme a esteira da vaga na Gupy (best-effort). Sem ela,
  // as sub-abas sairiam em ordem de contagem, não de funil.
  const [ordemEtapas, setOrdemEtapas] = useState<string[]>([]);
  // Banco de talentos (aba "Indicados pela IA") — busca vetorial, sem IA generativa.
  const [talentos, setTalentos] = useState<TalentosResponse | null>(null);
  const [carregandoTalentos, setCarregandoTalentos] = useState(false);
  const [erroTalentos, setErroTalentos] = useState<string | null>(null);
  // candidatoId sendo puxado do banco (desabilita só o botão daquela linha).
  const [puxando, setPuxando] = useState<string | null>(null);
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

  // Tamanho de cada página da lista (o servidor ordena: com nota primeiro).
  const PAGINA = 200;
  const [carregandoMais, setCarregandoMais] = useState(false);

  // Candidaturas: busca no servidor por nome (varre todos, não só os exibidos).
  // Carrega a PRIMEIRA página; "Carregar mais" anexa as seguintes (offset).
  const carregarCandidaturas = useCallback(
    async (q: string, etapa: string) => {
      setCarregando(true);
      setErro(null);
      try {
        const resp = await api<CandidaturasResponse>(
          `/api/vagas/${vagaId}/candidaturas`,
          {
            query: {
              limite: PAGINA,
              offset: 0,
              q: q.trim() || undefined,
              // Carrega todos (inclui descartados) — a separação por aba
              // (Candidatos / Reprovados / Desistentes) é feita no cliente.
              incluirReprovados: 'true',
              etapa: etapa === TODAS_ETAPAS ? undefined : etapa,
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

  // Próxima página (vagas com mais candidatos que uma página — ex.: 1000+).
  async function carregarMais() {
    if (!data || carregandoMais) return;
    setCarregandoMais(true);
    try {
      const resp = await api<CandidaturasResponse>(
        `/api/vagas/${vagaId}/candidaturas`,
        {
          query: {
            limite: PAGINA,
            offset: data.itens.length,
            q: busca.trim() || undefined,
            incluirReprovados: 'true',
            etapa: etapaSel === TODAS_ETAPAS ? undefined : etapaSel,
          },
        },
      );
      setData({
        ...resp,
        itens: [...data.itens, ...resp.itens],
      });
    } catch (err) {
      if (err instanceof ApiError) setErro(err.message);
      else setErro('Não conseguimos carregar mais candidatos. Tente de novo.');
    } finally {
      setCarregandoMais(false);
    }
  }

  useEffect(() => {
    void carregarVaga();
  }, [carregarVaga]);

  // Debounce da busca (e carga inicial quando busca = ''). Trocar de sub-aba de
  // etapa também recarrega — o filtro é do servidor.
  useEffect(() => {
    const t = setTimeout(() => void carregarCandidaturas(busca, etapaSel), 300);
    return () => clearTimeout(t);
  }, [busca, etapaSel, carregarCandidaturas]);

  // Ordem das etapas na esteira da Gupy (best-effort — se a Gupy falhar, as
  // sub-abas caem para a ordem por volume, que o resumo já devolve).
  useEffect(() => {
    if (!vaga?.gupy_id) return;
    let cancelado = false;
    void (async () => {
      try {
        const etapas = await api<Array<{ id: number; name: string }>>(
          `/api/gupy/vagas/${vaga.gupy_id}/etapas`,
        );
        if (!cancelado) setOrdemEtapas(etapas.map((e) => e.name));
      } catch {
        /* sem ordem da Gupy — segue com a ordem do resumo */
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [vaga?.gupy_id]);

  // Talentos sugeridos: carrega sob demanda, ao abrir a aba.
  // `min` permite afrouxar o piso pontualmente ("ver os mais próximos mesmo
  // assim") sem mudar a configuração da instalação.
  const carregarTalentos = useCallback(async (min?: number) => {
    setCarregandoTalentos(true);
    setErroTalentos(null);
    try {
      const resp = await api<TalentosResponse>(
        `/api/vagas/${vagaId}/talentos-sugeridos`,
        { query: { limite: 20, minSimilaridade: min } },
      );
      setTalentos(resp);
    } catch (err) {
      setTalentos(null);
      setErroTalentos(
        err instanceof ApiError
          ? err.message
          : 'Não conseguimos consultar o banco de talentos agora.',
      );
    } finally {
      setCarregandoTalentos(false);
    }
  }, [vagaId]);

  useEffect(() => {
    if (aba === 'talentos' && talentos === null && !carregandoTalentos) {
      void carregarTalentos();
    }
  }, [aba, talentos, carregandoTalentos, carregarTalentos]);

  /**
   * Puxa alguém do banco de talentos para a vaga: cria a candidatura marcada
   * como indicação e recarrega as duas listas (a pessoa sai dos indicados e
   * aparece em Candidatos com o selo).
   */
  async function puxarTalento(candidatoId: string, nome: string) {
    setPuxando(candidatoId);
    setErro(null);
    setAviso(null);
    try {
      const r = await api<{ candidaturaId: string; jaExistia: boolean }>(
        `/api/vagas/${vagaId}/talentos/${candidatoId}/puxar`,
        { method: 'POST' },
      );
      setAviso(
        r.jaExistia
          ? `${nome} já estava na lista de candidatos desta vaga.`
          : `${nome} foi trazido(a) do banco de talentos. Aparece em "Candidatos" ` +
            'com o selo "banco de talentos" e já pode ser avaliado(a) pela IA.',
      );
      await Promise.all([
        carregarCandidaturas(busca, etapaSel),
        carregarTalentos(),
      ]);
      setAba('candidatos');
    } catch (err) {
      if (err instanceof ApiError) setErro(err.message);
      else setErro('Não conseguimos trazer essa pessoa para a vaga. Tente de novo.');
    } finally {
      setPuxando(null);
    }
  }

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
      await Promise.all([carregarCandidaturas(busca, etapaSel), carregarVaga()]);
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

      // Fase 2 — Claude apenas no top-N por similaridade vetorial. Roda em
      // BACKGROUND no servidor (a rodada paralela do Claude pode passar do
      // timeout do proxy); acompanhamos por polling até terminar.
      setAviso(`Passo 2 de 2: avaliando os ${TOP_N} currículos mais parecidos com a vaga…`);
      await api(`/api/vagas/${vagaId}/vetorial/avaliar-proximos`, {
        method: 'POST',
        body: { n: TOP_N, incluirReprovados: incluir },
      });
      const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));
      let r = {
        avaliadosAgora: 0,
        pendentesLLM: 0,
        embedados: 0,
        emAndamento: true,
        ultimoErro: null as string | null,
      };
      for (let i = 0; i < 200; i++) {
        await sleep(3000);
        r = await api<typeof r>(
          `/api/vagas/${vagaId}/vetorial/avaliar-proximos/status`,
          { query: { incluirReprovados: incluir ? 'true' : undefined } },
        );
        if (!r.emAndamento) break;
        setAviso('Passo 2 de 2: avaliando com IA… isso leva alguns instantes.');
      }
      await carregarCandidaturas(busca, etapaSel);
      setPendentesLLM(r.pendentesLLM);
      if (r.ultimoErro) {
        setAviso(null);
        setErro(`Não foi possível avaliar com IA. Motivo: ${r.ultimoErro}`);
      } else if (r.avaliadosAgora === 0 && r.embedados === 0) {
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
        await carregarCandidaturas(busca, etapaSel);
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

  // Separa as candidaturas carregadas por aba de STATUS, no cliente (a de
  // ETAPA, essa sim, é filtrada no servidor).
  const itensTodos = data?.itens ?? [];
  const grupos: Record<
    'candidatos' | 'reprovados' | 'desistentes',
    CandidaturaItem[]
  > = {
    candidatos: itensTodos.filter((i) => !STATUS_DESCARTADOS.includes(i.status)),
    reprovados: itensTodos.filter((i) => i.status === 'REPROVADO'),
    desistentes: itensTodos.filter((i) => i.status === 'DESISTENTE'),
  };
  const itensAba = aba === 'talentos' ? [] : grupos[aba];

  // Sub-abas de etapa: "Todos" + as etapas que têm gente, na ORDEM DO FUNIL da
  // Gupy. Etapas que a Gupy não conhece (renomeadas, vaga antiga) vão depois, e
  // "Sem etapa" fecha a lista.
  const resumo = data?.resumoEtapas ?? [];
  const totalAtivos = resumo.reduce((acc, r) => acc + r.total, 0);
  const nomeadas = resumo.filter(
    (r): r is { etapa: string; total: number } => r.etapa != null,
  );
  const naOrdemGupy = ordemEtapas
    .map((nome) => nomeadas.find((r) => r.etapa === nome))
    .filter((r): r is { etapa: string; total: number } => Boolean(r));
  const forasDaEsteira = nomeadas.filter((r) => !ordemEtapas.includes(r.etapa));
  const semEtapa = resumo.find((r) => r.etapa == null);
  const subAbas: Array<{ id: string; label: string; total: number }> = [
    { id: TODAS_ETAPAS, label: 'Todos', total: totalAtivos },
    ...[...naOrdemGupy, ...forasDaEsteira].map((r) => ({
      id: r.etapa,
      label: r.etapa,
      total: r.total,
    })),
    ...(semEtapa ? [{ id: SEM_ETAPA, label: 'Sem etapa', total: semEtapa.total }] : []),
  ];

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
              : etapaSel === TODAS_ETAPAS
                ? `${data.total} candidato(s) nesta vaga.`
                : // Com filtro de etapa, `total` é o da etapa — dizer "nesta vaga"
                  // faria parecer que a vaga encolheu.
                  `${data.total} candidato(s) na etapa ${
                    etapaSel === SEM_ETAPA ? '“sem etapa”' : `“${etapaSel}”`
                  } — de ${totalAtivos} ativo(s) na vaga.`
            : ''
        }
        acoes={
          <>
            <Link href="/vagas" className="btn-soft">
              ← Vagas
            </Link>
            {vaga?.url_gupy && (
              <a
                href={vaga.url_gupy}
                target="_blank"
                rel="noreferrer"
                className="btn-soft"
                title="Abre a página pública desta vaga no portal de carreiras — o que o candidato vê."
              >
                Ver na Gupy ↗
              </a>
            )}
            <button
              type="button"
              className="btn-soft"
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
      ) : !data ? (
        <EmptyState
          titulo="Nenhum candidato ainda"
          descricao="Clique em 'Buscar candidatos da Gupy' para trazer os candidatos desta vaga."
        />
      ) : (
        <>
          {/* Abas: status (Candidatos/Reprovados/Desistentes) + banco de talentos */}
          <div className="mb-3 flex gap-1 border-b border-grafite-100">
            {ABAS.map((t) => {
              const ativa = aba === t.id;
              const talentosAba = t.id === 'talentos';
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    setAba(t.id);
                    // Filtro de etapa só faz sentido no funil desta vaga.
                    if (t.id !== 'candidatos') setEtapaSel(TODAS_ETAPAS);
                  }}
                  className={
                    '-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ' +
                    (ativa
                      ? talentosAba
                        ? 'border-violet-500 text-violet-700 dark:border-violet-400 dark:text-violet-300'
                        : 'border-unifique-600 text-unifique-700 dark:border-unifique-400 dark:text-unifique-400'
                      : 'border-transparent text-grafite-400 hover:text-grafite-600')
                  }
                  title={
                    talentosAba
                      ? 'Pessoas do banco de talentos parecidas com esta vaga. Não são candidatas — é uma indicação.'
                      : undefined
                  }
                >
                  {talentosAba && <span aria-hidden className="mr-1">✨</span>}
                  {t.label}
                  <span className="ml-1.5 text-xs tabular-nums text-grafite-400">
                    {t.id === 'talentos'
                      ? (talentos?.itens.length ?? '')
                      : grupos[t.id].length}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Sub-abas por ETAPA do funil (o DHO trabalha assim na Gupy).
              "Todos" mantém a comparação de notas entre etapas. */}
          {aba === 'candidatos' && subAbas.length > 1 && (
            <div className="mb-3 flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-xs uppercase tracking-wide text-grafite-400">
                Etapa
              </span>
              {subAbas.map((s) => {
                const ativa = etapaSel === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setEtapaSel(s.id)}
                    className={
                      'rounded-full border px-3 py-1 text-xs font-medium transition-colors ' +
                      (ativa
                        ? 'border-unifique-600 bg-unifique-50 text-unifique-700 dark:bg-unifique-500/15 dark:border-unifique-500/40 dark:text-unifique-300'
                        : 'border-grafite-200 text-grafite-600 hover:bg-grafite-50')
                    }
                  >
                    {s.label}
                    <span className="ml-1.5 tabular-nums text-grafite-400">
                      {s.total}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {aba === 'talentos' ? (
            <PainelTalentos
              dados={talentos}
              carregando={carregandoTalentos}
              erro={erroTalentos}
              onRecarregar={(min) => void carregarTalentos(min)}
              onPuxar={puxarTalento}
              puxando={puxando}
            />
          ) : itensAba.length === 0 ? (
            <div className="card p-6 text-sm text-grafite-400">
              {busca.trim()
                ? `Nenhum candidato corresponde a “${busca.trim()}”.`
                : aba === 'candidatos'
                  ? etapaSel === TODAS_ETAPAS
                    ? 'Nenhum candidato ativo nesta vaga.'
                    : 'Nenhum candidato nesta etapa.'
                  : aba === 'reprovados'
                    ? 'Nenhum candidato reprovado.'
                    : 'Nenhum candidato desistente.'}
            </div>
          ) : (
            <div className="card overflow-hidden">
              <div className="overflow-x-auto">
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
                <Th>{aba === 'reprovados' ? 'Motivo da reprovação' : 'Justificativa'}</Th>
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
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium text-grafite-900">
                        {it.candidatoNome}
                      </span>
                      {it.origem === 'BANCO_TALENTOS' && (
                        <span
                          className="inline-flex items-center gap-1 rounded-full border border-violet-300 bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 dark:border-violet-500/40 dark:bg-violet-500/15 dark:text-violet-300"
                          title="Não se inscreveu nesta vaga — foi trazido(a) do banco de talentos pelo recrutamento."
                        >
                          <span aria-hidden>✨</span> banco de talentos
                        </span>
                      )}
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
                    {(() => {
                      // Na aba Reprovados o que interessa é a DECISÃO humana,
                      // não a justificativa da IA.
                      const texto =
                        aba === 'reprovados'
                          ? it.motivoDesclassif
                          : it.justificativa;
                      if (!texto) return '—';
                      return texto.length > 180
                        ? `${texto.slice(0, 180)}…`
                        : texto;
                    })()}
                  </Td>
                  <Td className="text-right">
                    <Link
                      href={`/candidaturas/${it.candidaturaId}`}
                      className="btn-soft text-xs"
                    >
                      Ver detalhe →
                    </Link>
                  </Td>
                </tr>
              ))}
                </tbody>
              </table>
              </div>
            </div>
          )}

          {/* Paginação: vagas com mais candidatos que uma página (ex.: 1000+) */}
          {aba !== 'talentos' && data.itens.length < data.total && (
            <div className="mt-3 flex items-center justify-center gap-3">
              <span className="text-xs text-grafite-400">
                Mostrando {data.itens.length} de {data.total} candidato(s)
              </span>
              <button
                type="button"
                className="btn-soft text-xs"
                disabled={carregandoMais}
                onClick={() => void carregarMais()}
              >
                {carregandoMais ? 'Carregando…' : 'Carregar mais'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Aba "Indicados pela IA": pessoas do BANCO DE TALENTOS parecidas com a vaga.
 *
 * Separada de propósito das abas de candidatura: quem está aqui NÃO se
 * candidatou a esta vaga — é indicação, não inscrição. Por isso o painel tem
 * moldura própria (violeta), aviso explícito e nenhuma coluna de etapa/status,
 * que só fazem sentido para quem está no funil.
 *
 * A ordenação é por similaridade vetorial pura (pgvector) — sem IA generativa,
 * sem custo por consulta. A barra é RELATIVA ao primeiro da lista: o número
 * absoluto de similaridade não tem significado isolado, só a posição relativa.
 */
function PainelTalentos({
  dados,
  carregando,
  erro,
  onRecarregar,
  onPuxar,
  puxando,
}: {
  dados: TalentosResponse | null;
  carregando: boolean;
  erro: string | null;
  onRecarregar: (min?: number) => void;
  onPuxar: (candidatoId: string, nome: string) => void;
  puxando: string | null;
}) {
  if (carregando && !dados) {
    return (
      <div className="card p-6 text-sm text-grafite-400">
        Procurando talentos parecidos com esta vaga…
      </div>
    );
  }
  if (erro) {
    return (
      <div className="card p-6">
        <p className="text-sm text-red-600">{erro}</p>
        <button
          type="button"
          className="btn-soft mt-3 text-xs"
          onClick={() => onRecarregar()}
        >
          Tentar de novo
        </button>
      </div>
    );
  }
  if (!dados) return null;

  if (dados.vagaSemVetor) {
    return (
      <div className="card p-6">
        <p className="text-sm text-grafite-600">
          Esta vaga ainda não foi lida pela IA, então não dá para compará-la com o
          banco de talentos.
        </p>
        <p className="mt-2 text-sm text-grafite-400">
          Rode a <strong>Classificação completa</strong> uma vez — ela gera a
          leitura da vaga que esta busca usa. Depois volte aqui.
        </p>
      </div>
    );
  }

  const melhor = dados.itens[0]?.similaridade ?? 0;

  return (
    <div className="rounded-xl border-2 border-violet-200 bg-violet-50/40 p-1 dark:border-violet-500/30 dark:bg-violet-500/5">
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
        <div className="max-w-3xl">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-violet-800 dark:text-violet-300">
            <span aria-hidden>✨</span> Indicados pela IA — banco de talentos
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-grafite-600">
            Estas pessoas <strong>não se candidataram a esta vaga</strong>. Elas se
            inscreveram no <strong>banco de talentos</strong> e ficaram acima do
            piso de aderência de <strong>{dados.minSimilaridade}</strong> — quem
            se inscreveu na vaga tem preferência, então aqui só sobe quem for
            muito compatível. Normalmente esta lista vem vazia.
          </p>
        </div>
        <button
          type="button"
          className="btn-soft text-xs"
          disabled={carregando}
          onClick={() => onRecarregar()}
        >
          {carregando ? 'Atualizando…' : 'Atualizar'}
        </button>
      </div>

      {dados.itens.length === 0 ? (
        <div className="card p-6">
          {dados.totalPool === 0 ? (
            <p className="text-sm text-grafite-400">
              O banco de talentos ainda não tem ninguém com currículo lido pela IA.
            </p>
          ) : (
            <>
              <p className="text-sm text-grafite-600">
                Ninguém do banco de talentos atingiu o piso de{' '}
                <strong>{dados.minSimilaridade}</strong> de aderência para esta
                vaga.
                {dados.melhorDescartado != null && (
                  <>
                    {' '}
                    O mais próximo chegou a{' '}
                    <strong>{Math.round(dados.melhorDescartado)}</strong>.
                  </>
                )}
              </p>
              <p className="mt-2 text-xs text-grafite-400">
                Isso é o esperado na maioria das vagas — a preferência é de quem
                se inscreveu. Siga pelos candidatos da vaga.
              </p>
              {dados.melhorDescartado != null && (
                <button
                  type="button"
                  className="btn-soft mt-3 text-xs"
                  disabled={carregando}
                  onClick={() => onRecarregar(0)}
                  title="Mostra os mais próximos mesmo abaixo do piso — só para conferência, não é indicação."
                >
                  Ver os mais próximos mesmo assim
                </button>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-grafite-50 text-grafite-600">
                <tr>
                  <Th>#</Th>
                  <Th>Aderência</Th>
                  <Th>Pessoa</Th>
                  <Th>Contato</Th>
                  <Th>Local</Th>
                  <Th>Exp.</Th>
                  <Th>Origem</Th>
                  <Th></Th>
                </tr>
              </thead>
              <tbody>
                {dados.itens.map((t, idx) => (
                  <tr
                    key={t.candidatoId}
                    className="border-t border-grafite-100 hover:bg-grafite-50"
                  >
                    <Td className="tabular-nums text-grafite-400">{idx + 1}</Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        <span className="tabular-nums text-sm font-semibold text-violet-700 dark:text-violet-300">
                          {Math.round(t.similaridade)}
                        </span>
                        <span
                          className="h-1.5 w-16 overflow-hidden rounded-full bg-grafite-100"
                          title="Proximidade em relação ao primeiro da lista."
                        >
                          <span
                            className="block h-full rounded-full bg-violet-500"
                            style={{
                              width: `${melhor > 0 ? Math.round((t.similaridade / melhor) * 100) : 0}%`,
                            }}
                          />
                        </span>
                      </div>
                    </Td>
                    <Td>
                      <div className="font-medium text-grafite-900">
                        {t.candidatoNome}
                      </div>
                      {t.resumo && (
                        <div className="max-w-md text-xs text-grafite-400">
                          {t.resumo.length > 110
                            ? `${t.resumo.slice(0, 110)}…`
                            : t.resumo}
                        </div>
                      )}
                    </Td>
                    <Td className="text-xs text-grafite-600">
                      <div>{t.email ?? '—'}</div>
                      <div>{t.telefone ?? ''}</div>
                    </Td>
                    <Td className="text-grafite-600">
                      {[t.cidade, t.estado].filter(Boolean).join(' / ') || '—'}
                    </Td>
                    <Td className="tabular-nums text-grafite-600">
                      {t.anosExperiencia != null ? `${t.anosExperiencia} a` : '—'}
                    </Td>
                    <Td className="text-xs text-grafite-600">
                      <div>{t.vagaPoolTitulo}</div>
                      <div className="text-grafite-400">
                        {formatarData(t.inscritoEm)}
                      </div>
                    </Td>
                    <Td className="text-right whitespace-nowrap">
                      <Link
                        href={`/candidaturas/${t.candidaturaPoolId}`}
                        className="btn-soft mr-1.5 text-xs"
                      >
                        Ver perfil
                      </Link>
                      <button
                        type="button"
                        className="btn-primary text-xs"
                        disabled={puxando != null}
                        onClick={() => onPuxar(t.candidatoId, t.candidatoNome)}
                        title="Traz esta pessoa para a lista de candidatos da vaga, marcada como vinda do banco de talentos."
                      >
                        {puxando === t.candidatoId
                          ? 'Puxando…'
                          : 'Puxar para a vaga'}
                      </button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="px-4 py-2 text-xs text-grafite-400">
        {dados.itens.length} pessoa(s) acima do piso, de {dados.totalPool} no
        banco de talentos. “Puxar para a vaga” cria a candidatura aqui no Collab
        com o selo de indicação — não faz inscrição na Gupy.
      </p>
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
