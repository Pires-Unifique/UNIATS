import type { PapelUsuario } from '@uniats/db';

/**
 * Áreas de acesso (módulos). Fonte de verdade da autorização. 'admin' libera
 * tudo. Gestor NÃO é uma área — o acesso dele vem da posse da vaga (gestor_id).
 */
export type Area =
  | 'admin'
  | 'recrutamento'
  | 'admissao'
  | 'offboarding'
  // DHO — aprova/assina alterações contratuais. Exibida no produto como
  // "Administração de Pessoas" (o valor interno continua 'dho'). (O acesso do
  // LÍDER ao módulo não é uma área: virá da detecção de liderança — Senior/MS.)
  | 'dho'
  // Gestão de Acessos — administra a tela de Usuários (libera recrutamento,
  // admissão, dho…) SEM enxergar os processos em si. Não dá acesso ao resto da
  // seção Sistema (WhatsApp/Chaves de API seguem só 'admin').
  | 'gestao_acessos';

/**
 * Áreas que a tela de Usuários pode ATRIBUIR. 'offboarding' fica de fora:
 * está no tipo por compatibilidade, mas nenhum endpoint a usa hoje.
 */
export const AREAS_ATRIBUIVEIS: readonly Area[] = [
  'admin',
  'gestao_acessos',
  'recrutamento',
  'admissao',
  'dho',
];

/**
 * Áreas cuja CONCESSÃO/REVOGAÇÃO é exclusiva de 'admin' — e cujos portadores
 * só podem ser editados por 'admin'. Sem isso, quem tem 'gestao_acessos'
 * escalaria privilégio: promoveria um colega a admin (ou nomearia outro gestor
 * de acessos) e pediria de volta o favor.
 */
export const AREAS_SO_ADMIN: readonly Area[] = ['admin', 'gestao_acessos'];

/**
 * Escopos válidos para CHAVES DE API — as mesmas áreas dos usuários, exceto
 * 'admin': gestão de usuários/chaves/sistema é só para humanos logados.
 */
export const ESCOPOS_CHAVE_API: readonly Area[] = [
  'recrutamento',
  'admissao',
  'dho',
];

/**
 * Identidade resolvida pela camada de auth e anexada à requisição (`req.user`).
 * É SEMPRE o registro do nosso banco (não as claims cruas do token). A
 * autorização decide por `areas` (+ posse de vaga); `papel` é legado/exibição.
 */
export interface UsuarioAutenticado {
  id: string;
  azure_oid: string;
  email: string;
  nome: string;
  papel: PapelUsuario;
  areas: Area[];
  ativo: boolean;
  /** Presente (true) quando a requisição autenticou por CHAVE DE API (x-api-key). */
  chave_api?: boolean;
}

// Tipa `req.user` (Express/passport) como o nosso usuário autenticado.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface User extends UsuarioAutenticado {}
  }
}
