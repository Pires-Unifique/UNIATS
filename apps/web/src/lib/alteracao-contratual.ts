import type { StatusAlteracaoContratual } from '@uniats/shared';

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

/** Os 5 tipos de alteração, com rótulo (para checkboxes do formulário). */
export const TIPOS_ALTERACAO = [
  { tipo: 'CARGO', label: 'Cargo' },
  { tipo: 'SALARIO', label: 'Salário' },
  { tipo: 'CENTRO_CUSTO', label: 'Centro de custo' },
  { tipo: 'UNIDADE', label: 'Unidade' },
  { tipo: 'LIDER', label: 'Líder' },
] as const;
