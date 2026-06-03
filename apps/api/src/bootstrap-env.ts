/**
 * Carrega o .env da raiz do monorepo ANTES de qualquer módulo Nest.
 *
 * Usamos `override: true` de propósito: em alguns ambientes (CI, sandboxes,
 * shells corporativos) certas variáveis chegam pré-definidas como string
 * vazia. Sem o override, esses valores vazios venceriam o conteúdo real do
 * .env e a validação Zod falharia (ex.: ANTHROPIC_API_KEY "Required").
 *
 * Este arquivo precisa ser importado como PRIMEIRO efeito colateral em
 * main.ts, antes do AppModule (que avalia ConfigModule.forRoot no import).
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';

// A API roda com cwd em apps/api; o .env canônico fica na raiz do monorepo.
config({ path: resolve(process.cwd(), '../../.env'), override: true });
// Fallback opcional: um .env local em apps/api, se existir.
config({ path: resolve(process.cwd(), '.env'), override: true });
