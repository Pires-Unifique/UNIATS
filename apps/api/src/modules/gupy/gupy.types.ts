/**
 * Tipos auxiliares específicos do módulo Gupy
 * (separados dos schemas Zod para evitar import circular com o pacote shared).
 */

export interface ListarVagasParams {
  status?: string;          // ex.: "published"
  perPage?: number;         // default Gupy: 25 — máximo: 100
  page?: number;
  [k: string]: unknown;     // permite passar como Record<string, unknown> ao client HTTP
}

export interface ListarCandidaturasParams {
  jobId: bigint;
  status?: string;
  step?: string;
  perPage?: number;
  page?: number;
  [k: string]: unknown;
}

export interface PaginadoIterParams {
  perPage?: number;
}

export interface ListarEtapasParams {
  jobId: bigint;
  perPage?: number;
  page?: number;
  [k: string]: unknown;
}

/** Status permitidos pela Gupy ao mover uma candidatura. */
export type GupyStatusCandidatura = 'in_process' | 'reproved';

/**
 * Corpo aceito pelo POST /api/v1/jobs (criação de vaga).
 * Campos obrigatórios para publicar: name, description, type,
 * departmentId, roleId, hiringDeadline. Demais são opcionais.
 */
export interface CriarVagaGupyPayload {
  name: string;
  description: string;
  type: string;
  departmentId: number;
  roleId: number;
  hiringDeadline: string; // YYYY-MM-DD
  branchId?: number;
  numVacancies?: number;
  publicationType?: string;
  workplaceType?: string;
  responsibilities?: string;
  prerequisites?: string;
  additionalInformation?: string;
  code?: string;
  recruiterEmail?: string;
  managerEmail?: string;
  [k: string]: unknown;
}

/** Parâmetros de busca de estrutura organizacional (/os/v1/*). */
export interface ListarEstruturaParams {
  /** Filtro por nome (a API aceita `name`). */
  name?: string;
  page?: number;
  maxPageSize?: number;
  [k: string]: unknown;
}

/**
 * Parâmetros para mover uma candidatura entre etapas.
 * Pelo menos um entre `currentStepId` e `status` deve ser informado.
 */
export interface MoverCandidaturaParams {
  jobId: bigint;
  applicationId: bigint;
  /** Etapa de destino (obtida via listarEtapasDaVaga). */
  currentStepId?: bigint | number;
  status?: GupyStatusCandidatura;
  /** Motivo da reprovação — só faz sentido com status='reproved'. */
  disapprovalReason?: string;
  /** Nota livre do motivo (máx. 255 chars — truncada se exceder). */
  disapprovalReasonNotes?: string;
}
