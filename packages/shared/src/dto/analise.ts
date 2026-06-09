/**
 * DTOs do Painel Analítico do DHO (funil de recrutamento + métricas).
 *
 * Espelham o shape devolvido por `GET /api/analise/painel` e
 * `GET /api/analise/filtros`. Como TODO o frontend lê via `@uniats/shared`
 * (sem importar Prisma no navegador), este é o contrato único.
 *
 * IMPORTANTE: na ausência de um log de transições de etapa, várias métricas
 * são DERIVADAS de evidências (entrevistas, scores) e de timestamps existentes
 * (`inscrito_em`, `agendada_para`, `finalizada_em`, `movido_em`). O campo
 * `observacoes` carrega as limitações para exibição honesta na UI.
 */

/** Filtros aceitos pelo painel (todos opcionais). */
export interface FiltrosAnaliseDTO {
  /** ISO-8601 (data inicial, inclusiva) aplicada a `inscrito_em`. */
  de?: string | null;
  /** ISO-8601 (data final, inclusiva) aplicada a `inscrito_em`. */
  ate?: string | null;
  vagaId?: string | null;
  recrutadorId?: string | null;
}

export interface ResumoAnaliseDTO {
  totalCandidaturas: number;
  totalVagasComCandidatura: number;
  totalEntrevistas: number;
  contratados: number;
  /** contratados / inscritos (0..1). */
  taxaConversaoGeral: number;
  /** Média de dias entre inscrição e contratação. `null` se sem amostra. */
  tempoMedioContratacaoDias: number | null;
  /** no-show / (no-show + realizadas) (0..1). `null` se sem amostra. */
  taxaNoShow: number | null;
}

export interface FunilEtapaDTO {
  etapa: string;
  rotulo: string;
  /** Quantos alcançaram (pelo menos) esta etapa. */
  total: number;
  /** total desta etapa / total da etapa anterior (0..1). `null` na 1ª etapa. */
  taxaConversao: number | null;
}

export interface TempoMarcoDTO {
  marco: string;
  rotulo: string;
  /** Média em dias. `null` se sem amostra. */
  mediaDias: number | null;
  /** Tamanho da amostra usada na média. */
  amostra: number;
}

export interface EntrevistaStatusDTO {
  status: string;
  total: number;
}

export interface EntrevistasAnaliseDTO {
  porStatus: EntrevistaStatusDTO[];
  realizadas: number;
  naoCompareceu: number;
  agendadasFuturas: number;
  /** no-show / (no-show + realizadas) (0..1). `null` se sem amostra. */
  taxaNoShow: number | null;
}

export interface PorRecrutadorDTO {
  recrutadorId: string | null;
  nome: string;
  candidaturas: number;
  contratados: number;
  /** contratados / candidaturas (0..1). */
  taxaConversao: number;
}

export interface PorVagaDTO {
  vagaId: string;
  titulo: string;
  candidaturas: number;
  contratados: number;
  /** Média do score CONSOLIDADO (0..100). `null` se sem score. */
  scoreMedio: number | null;
}

export interface PainelAnaliseDTO {
  periodo: { de: string | null; ate: string | null };
  resumo: ResumoAnaliseDTO;
  funil: FunilEtapaDTO[];
  tempos: TempoMarcoDTO[];
  entrevistas: EntrevistasAnaliseDTO;
  porRecrutador: PorRecrutadorDTO[];
  porVaga: PorVagaDTO[];
  /** Limitações conhecidas (ex.: métricas aproximadas, fonte indisponível). */
  observacoes: string[];
}

export interface OpcoesFiltroDTO {
  recrutadores: Array<{ id: string; nome: string }>;
  vagas: Array<{ id: string; titulo: string }>;
}
