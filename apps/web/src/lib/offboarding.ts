import type {
  FormaAssinatura,
  OrigemOffboarding,
  StatusConvite,
  StatusItemEncerramento,
  StatusOffboarding,
  TipoDesligamento,
} from '@uniats/shared';

// Rótulos e constantes de RUNTIME do módulo. Ficam no web (não em @uniats/shared)
// porque o front importa só TIPOS do shared (`import type`, apagado no build);
// importar valores de lá faria o webpack empacotar o source do pacote. Espelha
// `@/lib/alteracao-contratual`.

/** Classe de badge (globals.css) para cada status. */
export const BADGE_STATUS_OFFBOARDING: Record<StatusOffboarding, string> = {
  RASCUNHO: 'badge-gray',
  AGUARDANDO_APROVACAO_GESTOR: 'badge-yellow',
  AGUARDANDO_APROVACAO_DHO: 'badge-yellow',
  AGUARDANDO_ASSINATURAS: 'badge-blue',
  ASSINADO: 'badge-blue',
  EM_ENCERRAMENTO: 'badge-yellow',
  CONCLUIDO: 'badge-green',
  RECUSADO: 'badge-red',
  CANCELADO: 'badge-gray',
};

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
  COLABORADOR: 'Colaborador',
  EMPREGADOR: 'Empregador',
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

export const BADGE_ITEM_ENCERRAMENTO: Record<StatusItemEncerramento, string> = {
  PENDENTE: 'badge-yellow',
  CONCLUIDO: 'badge-green',
  NAO_APLICAVEL: 'badge-gray',
  FALHA: 'badge-red',
};

export const ROTULO_STATUS_CONVITE: Record<StatusConvite, string> = {
  PENDENTE: 'Pendente',
  USADO: 'Utilizado',
  EXPIRADO: 'Expirado',
  CANCELADO: 'Cancelado',
};

export const BADGE_STATUS_CONVITE: Record<StatusConvite, string> = {
  PENDENTE: 'badge-blue',
  USADO: 'badge-green',
  EXPIRADO: 'badge-gray',
  CANCELADO: 'badge-gray',
};

/** Origens disponíveis no formulário. */
export const ORIGENS_OFFBOARDING = [
  { origem: 'EMPREGADOR', label: 'Líder / Empregador' },
  { origem: 'COLABORADOR', label: 'O próprio colaborador' },
] as const;

/** Tipos de desligamento disponíveis no formulário. */
export const TIPOS_DESLIGAMENTO = [
  { tipo: 'PEDIDO_COLABORADOR', label: 'Pedido do próprio colaborador' },
  { tipo: 'SEM_JUSTA_CAUSA', label: 'Iniciativa do empregador (sem justa causa)' },
  { tipo: 'TERMINO_EXPERIENCIA_DISTRATO', label: 'Término de experiência / Distrato' },
  { tipo: 'JUSTA_CAUSA', label: 'Justa causa' },
] as const;

/** Formas de assinatura disponíveis no formulário. */
export const FORMAS_ASSINATURA = [
  { forma: 'DIGITAL', label: 'Digital (Autentique)' },
  { forma: 'FISICA', label: 'Física (procurador)' },
] as const;
