/**
 * DTOs do módulo de ALTERAÇÃO CONTRATUAL (DHO).
 *
 * Espelham o shape devolvido pelos controllers REST (`/api/alteracao-contratual`
 * e subrotas de catálogo). Como TODO o frontend lê via `@uniats/shared` (sem
 * importar Prisma no navegador), este é o contrato único entre back e front.
 *
 * Os enums de string abaixo espelham EXATAMENTE os enums do Prisma (packages/db).
 */

// ---------- Enums (espelham Prisma) ----------

export type TipoAlteracaoContratual =
  | 'CARGO'
  | 'SALARIO'
  | 'CENTRO_CUSTO'
  | 'UNIDADE' // = "filial"
  | 'LIDER';

export type StatusAlteracaoContratual =
  | 'RASCUNHO'
  | 'AGUARDANDO_APROVACAO_DHO'
  | 'AGUARDANDO_ASSINATURAS'
  | 'ASSINADO'
  | 'AGENDADA'
  | 'EXECUTADA'
  | 'FALHA_EXECUCAO'
  | 'CANCELADA';

export type PapelAssinante = 'GESTOR' | 'DHO';

export type StatusAssinatura = 'PENDENTE' | 'ENVIADA' | 'ASSINADA' | 'RECUSADA';

// Ordem canônica do ciclo de vida (para stepper/board). CANCELADA/FALHA fora do fluxo feliz.
export const ETAPAS_ALTERACAO: readonly StatusAlteracaoContratual[] = [
  'RASCUNHO',
  'AGUARDANDO_APROVACAO_DHO',
  'AGUARDANDO_ASSINATURAS',
  'ASSINADO',
  'AGENDADA',
  'EXECUTADA',
] as const;

export const ROTULO_STATUS_ALTERACAO: Record<StatusAlteracaoContratual, string> = {
  RASCUNHO: 'Rascunho',
  AGUARDANDO_APROVACAO_DHO: 'Aguardando aprovação do DHO',
  AGUARDANDO_ASSINATURAS: 'Aguardando assinaturas',
  ASSINADO: 'Assinado',
  AGENDADA: 'Agendada',
  EXECUTADA: 'Executada',
  FALHA_EXECUCAO: 'Falha na execução',
  CANCELADA: 'Cancelada',
};

export const ROTULO_TIPO_ALTERACAO: Record<TipoAlteracaoContratual, string> = {
  CARGO: 'Cargo',
  SALARIO: 'Salário',
  CENTRO_CUSTO: 'Centro de custo',
  UNIDADE: 'Unidade',
  LIDER: 'Líder',
};

// ---------- Catálogo ----------

export interface CargoDTO {
  id: string;
  codigo?: string | null;
  titulo: string;
  senioridade?: string | null;
  descricao?: string | null;
  ativo: boolean;
  origem: string;
  criado_em: string;
  atualizado_em: string;
}

export interface UnidadeDTO {
  id: string;
  externo_id: string; // id/código da filial na fonte (view do Senior)
  codigo?: string | null;
  nome: string;
  cidade?: string | null;
  estado?: string | null;
  ativo: boolean;
}

export interface CentroCustoDTO {
  id: string;
  senior_id: string;
  codigo?: string | null;
  nome: string;
  ativo: boolean;
}

export interface ColaboradorDTO {
  id: string;
  matricula: string;
  nome: string;
  email?: string | null;
  // Situação atual (snapshot do Senior). SEM salário — regra de negócio.
  unidade_id?: string | null;
  unidade_nome?: string | null;
  centro_custo_id?: string | null;
  centro_custo_nome?: string | null;
  cargo_atual?: string | null;
  lider_matricula?: string | null;
  lider_nome?: string | null;
  ativo: boolean;
}

// ---------- Solicitação ----------

export interface ItemAlteracaoDTO {
  id: string;
  tipo: TipoAlteracaoContratual;
  valor_anterior?: string | null;
  valor_novo: string;
  cargo_novo_id?: string | null;
  unidade_nova_id?: string | null;
  centro_custo_novo_id?: string | null;
  salario_anterior?: string | null; // Decimal vira string em JSON
  salario_novo?: string | null;
  novo_lider_matricula?: string | null;
  novo_lider_nome?: string | null;
}

export interface AssinaturaAlteracaoDTO {
  id: string;
  papel: PapelAssinante;
  nome: string;
  email: string;
  ordem: number;
  status: StatusAssinatura;
  link_assinatura?: string | null;
  assinado_em?: string | null;
  recusado_em?: string | null;
  motivo_recusa?: string | null;
}

export interface EventoAlteracaoDTO {
  id: string;
  de_status?: StatusAlteracaoContratual | null;
  para_status: StatusAlteracaoContratual;
  autor_nome?: string | null;
  observacao?: string | null;
  criado_em: string;
}

export interface ExecucaoAlteracaoDTO {
  id: string;
  agendada_para: string;
  executada_em?: string | null;
  sucesso?: boolean | null;
  tentativas: number;
  erro?: string | null;
}

// Item de listagem
export interface SolicitacaoAlteracaoListItemDTO {
  id: string;
  status: StatusAlteracaoContratual;
  colaborador_nome: string;
  colaborador_matricula: string;
  solicitante_nome: string;
  tipos: TipoAlteracaoContratual[];
  data_aplicacao: string;
  criado_em: string;
  atualizado_em: string;
}

// Detalhe agregado
export interface SolicitacaoAlteracaoDetalheDTO {
  id: string;
  status: StatusAlteracaoContratual;
  solicitante_id?: string | null;
  solicitante_nome: string;
  colaborador_id?: string | null;
  colaborador_matricula: string;
  colaborador_nome: string;
  // Situação atual (snapshot)
  unidade_atual?: string | null;
  centro_custo_atual?: string | null;
  cargo_atual?: string | null;
  lider_atual?: string | null;
  razoes: string;
  data_aplicacao: string;
  // Autentique
  autentique_documento_id?: string | null;
  documento_url?: string | null;
  enviado_assinatura_em?: string | null;
  assinado_em?: string | null;
  // Aprovação DHO
  aprovado_por_nome?: string | null;
  aprovado_em?: string | null;
  motivo_recusa?: string | null;
  observacoes?: string | null;
  criado_em: string;
  atualizado_em: string;
  itens: ItemAlteracaoDTO[];
  assinaturas: AssinaturaAlteracaoDTO[];
  eventos: EventoAlteracaoDTO[];
  execucao?: ExecucaoAlteracaoDTO | null;
}

// ---------- Entrada (criação) ----------

export interface ItemAlteracaoInputDTO {
  tipo: TipoAlteracaoContratual;
  valor_anterior?: string | null;
  valor_novo?: string | null;
  cargo_novo_id?: string | null;
  unidade_nova_id?: string | null;
  centro_custo_novo_id?: string | null;
  // SALÁRIO — informados manualmente (NÃO consultamos o Senior).
  salario_anterior?: string | number | null;
  salario_novo?: string | number | null;
  // LÍDER
  novo_lider_matricula?: string | null;
  novo_lider_nome?: string | null;
}

export interface CriarSolicitacaoAlteracaoInputDTO {
  colaborador_id?: string | null;
  colaborador_matricula: string;
  colaborador_nome: string;
  unidade_atual?: string | null;
  centro_custo_atual?: string | null;
  cargo_atual?: string | null;
  lider_atual?: string | null;
  razoes: string;
  data_aplicacao: string; // ISO date (YYYY-MM-DD)
  itens: ItemAlteracaoInputDTO[];
}
