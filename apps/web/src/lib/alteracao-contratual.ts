import type {
  StatusAlteracaoContratual,
  TipoAlteracaoContratual,
} from '@uniats/shared';

// Rótulos e constantes de RUNTIME do módulo. Ficam no web (não em @uniats/shared)
// porque o front importa só TIPOS do shared (`import type`, que é apagado no build);
// importar valores de lá faria o webpack empacotar o source do pacote. Espelha o
// padrão de `@/lib/admissao` (ROTULO_ETAPA_ADMISSAO etc.).

/** Classe de badge (globals.css) para cada status. */
export const BADGE_STATUS_ALTERACAO: Record<StatusAlteracaoContratual, string> = {
  RASCUNHO: 'badge-gray',
  AGUARDANDO_APROVACAO_DHO: 'badge-yellow',
  AGUARDANDO_ASSINATURAS: 'badge-blue',
  ASSINADO: 'badge-blue',
  AGENDADA: 'badge-yellow',
  EXECUTADA: 'badge-green',
  FALHA_EXECUCAO: 'badge-red',
  CANCELADA: 'badge-gray',
};

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

/** Os 5 tipos de alteração, com rótulo (para checkboxes do formulário). */
export const TIPOS_ALTERACAO = [
  { tipo: 'CARGO', label: 'Cargo' },
  { tipo: 'SALARIO', label: 'Salário' },
  { tipo: 'CENTRO_CUSTO', label: 'Centro de custo' },
  { tipo: 'UNIDADE', label: 'Unidade' },
  { tipo: 'LIDER', label: 'Líder' },
] as const;
