import type { PapelUsuario } from '@uniats/db';

/**
 * Áreas de acesso (módulos). Fonte de verdade da autorização. 'admin' libera
 * tudo. Gestor NÃO é uma área — o acesso dele vem da posse da vaga (gestor_id).
 */
export type Area = 'admin' | 'recrutamento' | 'admissao' | 'offboarding';

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
}

// Tipa `req.user` (Express/passport) como o nosso usuário autenticado.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface User extends UsuarioAutenticado {}
  }
}
