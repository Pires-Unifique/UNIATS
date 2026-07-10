import type { Area } from './auth';

/**
 * Rótulos das áreas no PRODUTO. O valor interno 'dho' é exibido como
 * "Administração de Pessoas" (mesmo nome da seção do menu) — os endpoints
 * continuam usando 'dho'. Espelha AREAS_ATRIBUIVEIS do backend.
 */
export const AREA_LABELS: Record<Area, string> = {
  admin: 'Admin',
  gestao_acessos: 'Gestão de Acessos',
  recrutamento: 'Recrutamento',
  admissao: 'Admissão',
  dho: 'Administração de Pessoas',
  offboarding: 'Offboarding (reservada)',
};

/** Áreas que a tela de Usuários pode atribuir (offboarding fora — sem uso hoje). */
export const AREAS_ATRIBUIVEIS: Array<{ valor: Area; label: string; descricao: string }> = [
  { valor: 'admin', label: 'Admin', descricao: 'tudo, incluindo a seção Sistema' },
  { valor: 'gestao_acessos', label: 'Gestão de Acessos', descricao: 'só a tela Usuários — libera e revoga acessos, sem ver os processos' },
  { valor: 'recrutamento', label: 'Recrutamento', descricao: 'todas as vagas, publicar, análise, cargos' },
  { valor: 'admissao', label: 'Admissão', descricao: 'fila de admissões' },
  { valor: 'dho', label: 'Administração de Pessoas', descricao: 'alteração contratual, offboarding, procuradores' },
];

/**
 * Áreas que SÓ um admin concede/revoga (espelha AREAS_SO_ADMIN do backend).
 * A tela esconde esses checkboxes de quem não é admin — a API recusa de
 * qualquer forma (a trava real é do servidor).
 */
export const AREAS_SO_ADMIN: readonly Area[] = ['admin', 'gestao_acessos'];

/** Escopos válidos para chaves de API — sem 'admin' (só humanos logados). */
export const ESCOPOS_CHAVE_API: Array<{ valor: Area; label: string }> = [
  { valor: 'recrutamento', label: 'Recrutamento' },
  { valor: 'admissao', label: 'Admissão' },
  { valor: 'dho', label: 'Administração de Pessoas' },
];

export function labelArea(area: string): string {
  return AREA_LABELS[area as Area] ?? area;
}
