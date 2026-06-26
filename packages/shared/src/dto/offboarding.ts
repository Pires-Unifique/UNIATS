/**
 * DTOs do módulo de OFFBOARDING (DHO).
 *
 * Espelham o shape devolvido pelos controllers REST (`/api/offboarding` e
 * subrotas). Como TODO o frontend lê via `@uniats/shared` (sem importar Prisma
 * no navegador), este é o contrato único entre back e front.
 *
 * Os enums de string abaixo espelham EXATAMENTE os enums do Prisma (packages/db).
 */

// `StatusAssinatura` é compartilhado com a Alteração Contratual (mesmo enum
// Prisma `status_assinatura`); importamos sem reexportar p/ não duplicar no index.
import type { StatusAssinatura } from './alteracao-contratual.js';

// ---------- Enums (espelham Prisma) ----------

export type OrigemOffboarding = 'COLABORADOR' | 'EMPREGADOR';

export type TipoDesligamento =
  | 'PEDIDO_COLABORADOR'
  | 'SEM_JUSTA_CAUSA'
  | 'TERMINO_EXPERIENCIA_DISTRATO'
  | 'JUSTA_CAUSA';

export type FormaAssinatura = 'DIGITAL' | 'FISICA';

export type StatusOffboarding =
  | 'RASCUNHO'
  | 'AGUARDANDO_APROVACAO_GESTOR'
  | 'AGUARDANDO_APROVACAO_DHO'
  | 'AGUARDANDO_ASSINATURAS'
  | 'ASSINADO'
  | 'EM_ENCERRAMENTO'
  | 'CONCLUIDO'
  | 'RECUSADO'
  | 'CANCELADO';

export type PapelAssinanteOffboarding = 'COLABORADOR' | 'REPRESENTANTE_EMPRESA';

export type CategoriaItemEncerramento = 'INTEGRACAO' | 'CHECKLIST';

export type StatusItemEncerramento =
  | 'PENDENTE'
  | 'CONCLUIDO'
  | 'NAO_APLICAVEL'
  | 'FALHA';

export type TipoRespostaItem = 'AUTOMATICO' | 'BOOLEANO' | 'TEXTO';

// Ordem canônica do ciclo de vida (para stepper/board). RECUSADO/CANCELADO fora do fluxo feliz.
export const ETAPAS_OFFBOARDING: readonly StatusOffboarding[] = [
  'RASCUNHO',
  'AGUARDANDO_APROVACAO_GESTOR',
  'AGUARDANDO_APROVACAO_DHO',
  'AGUARDANDO_ASSINATURAS',
  'ASSINADO',
  'EM_ENCERRAMENTO',
  'CONCLUIDO',
] as const;

export const ROTULO_STATUS_OFFBOARDING: Record<StatusOffboarding, string> = {
  RASCUNHO: 'Rascunho',
  AGUARDANDO_APROVACAO_GESTOR: 'Aguardando aprovação do gestor',
  AGUARDANDO_APROVACAO_DHO: 'Aguardando aprovação do DHO',
  AGUARDANDO_ASSINATURAS: 'Aguardando assinaturas',
  ASSINADO: 'Assinado',
  EM_ENCERRAMENTO: 'Em encerramento',
  CONCLUIDO: 'Concluído',
  RECUSADO: 'Recusado',
  CANCELADO: 'Cancelado',
};

export const ROTULO_ORIGEM_OFFBOARDING: Record<OrigemOffboarding, string> = {
  COLABORADOR: 'Solicitado pelo colaborador',
  EMPREGADOR: 'Solicitado pelo empregador',
};

export const ROTULO_TIPO_DESLIGAMENTO: Record<TipoDesligamento, string> = {
  PEDIDO_COLABORADOR: 'Pedido do próprio colaborador',
  SEM_JUSTA_CAUSA: 'Iniciativa do empregador (sem justa causa)',
  TERMINO_EXPERIENCIA_DISTRATO: 'Término de experiência / Distrato',
  JUSTA_CAUSA: 'Justa causa',
};

export const ROTULO_FORMA_ASSINATURA: Record<FormaAssinatura, string> = {
  DIGITAL: 'Assinatura digital (Autentique)',
  FISICA: 'Assinatura física (procurador)',
};

export const ROTULO_PAPEL_ASSINANTE_OFFBOARDING: Record<
  PapelAssinanteOffboarding,
  string
> = {
  COLABORADOR: 'Colaborador',
  REPRESENTANTE_EMPRESA: 'Representante da empresa',
};

// ---------- Snapshot demissional do Senior ----------

/**
 * Espelho dos dados demissionais buscados no Senior (todos opcionais — a conexão
 * real fica para depois da homologação; por ora vem simulado). Congelado em JSON
 * na solicitação (`senior_snapshot`).
 */
export interface OffboardingSeniorSnapshot {
  nome_completo?: string | null;
  filial?: string | null;
  centro_custo?: string | null;
  data_admissao?: string | null; // YYYY-MM-DD
  data_termino_cumprimento?: string | null;
  prazo_homologacao?: string | null;
  pagamento_ate_dia?: string | null;
  agendamento_homologacao?: string | null;
  agendamento_exame_demissional?: string | null;
  email_pessoal?: string | null;
  whatsapp_pessoal?: string | null;
  possui_ferias?: boolean | null;
  possui_cargo_lideranca?: boolean | null;
  possui_procuracao?: boolean | null;
  efetua_registro_ponto?: boolean | null;
  presencial_ou_home?: string | null; // "Presencial" | "Home office" | "Híbrido"
  data_ultimo_aso?: string | null;
  lideranca_imediata?: string | null;
  transferido_de_unidade?: boolean | null;
  atestado?: string | null;
  afastamentos?: string | null;
  pcd?: boolean | null;
  reabilitado?: boolean | null;
  estabilidades?: string | null;
  menor?: boolean | null;
  cargo?: string | null;
  cpf?: string | null;
  email_corporativo?: string | null;
  escala_trabalho?: string | null;
  situacao_atual?: string | null;
}

// ---------- Catálogo de procuradores ----------

export interface ProcuradorDTO {
  id: string;
  nome: string;
  email?: string | null;
  documento?: string | null;
  cargo?: string | null;
  ativo: boolean;
  observacao?: string | null;
  criado_em: string;
  atualizado_em: string;
}

// ---------- Itens de encerramento ----------

export interface ItemEncerramentoDTO {
  id: string;
  chave: string;
  categoria: CategoriaItemEncerramento;
  titulo: string;
  tipo_resposta: TipoRespostaItem;
  ordem: number;
  status: StatusItemEncerramento;
  resposta_bool?: boolean | null;
  resposta_texto?: string | null;
  respondido_por_nome?: string | null;
  respondido_em?: string | null;
}

// ---------- Assinaturas / Eventos ----------

export interface AssinaturaOffboardingDTO {
  id: string;
  papel: PapelAssinanteOffboarding;
  nome: string;
  email: string;
  ordem: number;
  status: StatusAssinatura;
  representante_origem?: string | null; // 'dho' | 'procurador'
  procurador_id?: string | null;
  link_assinatura?: string | null;
  assinado_em?: string | null;
  recusado_em?: string | null;
  motivo_recusa?: string | null;
}

export interface EventoOffboardingDTO {
  id: string;
  de_status?: StatusOffboarding | null;
  para_status: StatusOffboarding;
  autor_nome?: string | null;
  observacao?: string | null;
  criado_em: string;
}

// ---------- Solicitação ----------

export interface SolicitacaoOffboardingListItemDTO {
  id: string;
  status: StatusOffboarding;
  origem: OrigemOffboarding;
  tipo_desligamento: TipoDesligamento;
  colaborador_nome: string;
  colaborador_matricula: string;
  solicitante_nome: string;
  criado_em: string;
  atualizado_em: string;
}

export interface SolicitacaoOffboardingDetalheDTO {
  id: string;
  status: StatusOffboarding;
  origem: OrigemOffboarding;
  solicitante_id?: string | null;
  solicitante_nome: string;
  colaborador_id?: string | null;
  colaborador_matricula: string;
  colaborador_nome: string;
  // Formulário inicial
  tipo_desligamento: TipoDesligamento;
  cumpre_aviso_previo: boolean;
  aviso_previo_dias?: number | null;
  motivo: string;
  email_pessoal?: string | null;
  whatsapp_pessoal?: string | null;
  contatos_verificados: boolean;
  forma_assinatura: FormaAssinatura;
  // Situação atual (promovida do snapshot)
  unidade_atual?: string | null;
  centro_custo_atual?: string | null;
  cargo_atual?: string | null;
  data_admissao?: string | null;
  senior_snapshot?: OffboardingSeniorSnapshot | null;
  snapshot_capturado_em?: string | null;
  // Aprovações
  aprovado_gestor_por_nome?: string | null;
  aprovado_gestor_em?: string | null;
  aprovado_dho_por_nome?: string | null;
  aprovado_dho_em?: string | null;
  recusado_por_nome?: string | null;
  recusado_em?: string | null;
  motivo_recusa?: string | null;
  // Documento
  autentique_documento_id?: string | null;
  documento_url?: string | null;
  documento_gerado_em?: string | null;
  enviado_assinatura_em?: string | null;
  assinado_em?: string | null;
  // Documento assinado (upload manual) + validação do DHO (via física)
  documento_assinado_url?: string | null;
  documento_assinado_nome?: string | null;
  documento_assinado_em?: string | null;
  assinaturas_validadas_por_nome?: string | null;
  assinaturas_validadas_em?: string | null;
  observacoes?: string | null;
  criado_em: string;
  atualizado_em: string;
  assinaturas: AssinaturaOffboardingDTO[];
  itens_encerramento: ItemEncerramentoDTO[];
  eventos: EventoOffboardingDTO[];
}

// ---------- Entrada (criação) ----------

export interface CriarSolicitacaoOffboardingInputDTO {
  origem: OrigemOffboarding;
  colaborador_id?: string | null;
  colaborador_matricula: string;
  colaborador_nome: string;
  tipo_desligamento: TipoDesligamento;
  cumpre_aviso_previo: boolean;
  aviso_previo_dias?: number | null;
  motivo: string;
  email_pessoal?: string | null;
  whatsapp_pessoal?: string | null;
  forma_assinatura: FormaAssinatura;
}

// ---------- Convites de autodesligamento (link com token) ----------

export type StatusConvite = 'PENDENTE' | 'USADO' | 'EXPIRADO' | 'CANCELADO';

export const ROTULO_STATUS_CONVITE: Record<StatusConvite, string> = {
  PENDENTE: 'Pendente',
  USADO: 'Utilizado',
  EXPIRADO: 'Expirado',
  CANCELADO: 'Cancelado',
};

/** Convite visto pelo DHO (com o link para enviar ao colaborador). */
export interface ConviteOffboardingDTO {
  id: string;
  token: string;
  url: string; // link público pronto p/ enviar (ex.: /offboarding/auto/<token>)
  colaborador_matricula: string;
  colaborador_nome: string;
  criado_por_nome?: string | null;
  status: StatusConvite;
  expira_em: string;
  usado_em?: string | null;
  cancelado_em?: string | null;
  solicitacao_id?: string | null;
  criado_em: string;
}

export interface CriarConviteInputDTO {
  colaborador_id?: string | null;
  colaborador_matricula: string;
  colaborador_nome: string;
  expira_em_dias?: number | null; // default no backend (ex.: 14)
}

/**
 * Dados que o COLABORADOR vê ao abrir o link público (sem login). Só o
 * necessário; contatos vêm pré-preenchidos (espelho/Senior) e editáveis.
 */
export interface AutoPrefillDTO {
  valido: boolean;
  status: StatusConvite;
  colaborador_nome: string;
  colaborador_matricula: string;
  cargo?: string | null;
  unidade?: string | null;
  centro_custo?: string | null;
  email_pessoal?: string | null;
  whatsapp_pessoal?: string | null;
  expira_em: string;
}

/** O colaborador confirma o próprio desligamento pelo link. */
export interface ConfirmarAutodesligamentoInputDTO {
  motivo: string;
  cumpre_aviso_previo: boolean;
  aviso_previo_dias?: number | null;
  email_pessoal?: string | null;
  whatsapp_pessoal?: string | null;
}
