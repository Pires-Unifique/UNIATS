import { SetMetadata } from '@nestjs/common';
import type { Area } from './auth.types.js';

export const AREAS_KEY = 'areas';

/**
 * Restringe um handler/controller a áreas de acesso. Combine com
 * `@UseGuards(AuthGuard, AreasGuard)`. Quem tem a área 'admin' passa sempre.
 * Sem o decorator, qualquer usuário autenticado passa (a restrição fina de
 * posse de vaga fica nos endpoints de dados, via AuthService.assertVaga...).
 *
 * Ex.: `@Areas('recrutamento')` → ações de recrutamento (admissão/gestor não agem).
 */
export const Areas = (...areas: Area[]) => SetMetadata(AREAS_KEY, areas);
