/**
 * DTOs da tela de Início (dashboard do recrutador/gestor).
 *
 * Espelham o shape devolvido por `GET /api/dashboard`. Todos os números são
 * ESCOPADOS ao usuário logado (ver `escopo`): recrutamento/admin veem as vagas
 * em que são o recrutador (FK ou espelho de e-mail da Gupy); gestor vê as
 * vagas em que é o gestor. Quem tem recrutamento mas nenhuma vaga própria cai
 * na visão global — o front rotula a diferença.
 */
import type { FunilEtapaDTO } from './analise.js';

/** 'meu' = números do usuário; 'global' = visão geral (sem vaga própria). */
export type EscopoDashboard = 'meu' | 'global';

export interface EntrevistaHojeDTO {
  id: string;
  /** ISO-8601. */
  agendadaPara: string;
  duracaoMin: number;
  status: string;
  candidatoNome: string;
  vagaTitulo: string | null;
  candidaturaId: string | null;
  /** Link da call (Teams/Meet). Null enquanto o link não foi liberado. */
  meetUrl: string | null;
  /** Já existe transcrição processada (habilita o CTA "Ver análise"). */
  temAnalise: boolean;
}

export interface VagaResumoDashboardDTO {
  id: string;
  titulo: string;
  cidade: string | null;
  candidaturas: number;
  /** Dias desde a publicação (ou criação, se sem data). Null se desconhecido. */
  diasAberta: number | null;
  /** Maior score IA (CONSOLIDADO ou RANKING_CV) entre os candidatos. */
  topScore: number | null;
}

export interface PendenciasDashboardDTO {
  /** Enquetes de horário AGUARDANDO há mais de 24h. */
  enquetesSemResposta24h: number;
  /** Entrevistas FINALIZADAS (últimos 60 dias) sem parecer final. */
  entrevistasSemParecer: number;
  /** Candidaturas APROVADO_TRIAGEM paradas há mais de 7 dias, sem entrevista. */
  candidaturasParadas: number;
  /** Entrevistas NAO_COMPARECEU nos últimos 7 dias (para reagendar). */
  noShows7d: number;
  /** Vagas PUBLICADAS há mais de 14 dias sem nenhuma candidatura. */
  vagasSemCandidatura: number;
}

export interface DashboardDTO {
  escopo: EscopoDashboard;
  vagas: {
    publicadas: number;
    /** Publicadas sem nenhuma candidatura (qualquer idade). */
    semCandidatura: number;
  };
  /** Entrevistas de hoje (fuso de Brasília), em ordem de horário. */
  entrevistasHoje: EntrevistaHojeDTO[];
  /** Enquetes de horário aguardando resposta do candidato. */
  aguardandoCandidato: { total: number; ha24h: number };
  novosCandidatos: {
    total7d: number;
    /** Variação vs 7 dias anteriores (0..n, ex.: 0.12 = +12%). Null sem base. */
    variacaoSemana: number | null;
    /** Últimos 14 dias (fuso de Brasília), do mais antigo ao mais recente. */
    porDia: Array<{ dia: string; total: number }>;
  };
  /** Notificações ANALISE_PRONTA não lidas do usuário. */
  analisesProntas: number;
  pendencias: PendenciasDashboardDTO;
  /** Top 5 vagas publicadas por nº de candidaturas. */
  vagasTop: VagaResumoDashboardDTO[];
  /** Funil dos últimos 30 dias (mesma derivação do painel de Análise). */
  funil30d: FunilEtapaDTO[];
  /** no-show / (no-show + realizadas) nos últimos 30 dias. Null sem amostra. */
  taxaNoShow30d: number | null;
}
