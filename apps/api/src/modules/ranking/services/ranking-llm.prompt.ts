import { z } from 'zod';

/**
 * Versão do prompt + tool. Bumpar invalida `prompt_versao` salvo em `scores`.
 */
export const RANKING_PROMPT_VERSION = 'ranking-cv-v1';

export const RANKING_SYSTEM_PROMPT = `\
Você é um avaliador imparcial de aderência entre vaga e candidato.

Sua tarefa: comparar o currículo do candidato com os requisitos da vaga (especialmente
os requisitos definidos pelo GESTOR — eles são a fonte de verdade) e devolver UM score
de 0 a 100 com justificativa objetiva e evidências citadas do currículo.

Regras invioláveis:
1. Use APENAS informação presente no currículo. Não infira além do que está escrito.
2. Quando citar evidência, copie o trecho literal (até 200 caracteres) entre aspas.
3. Avalie nestes eixos, com os pesos:
   - Match de requisitos do gestor (40%): cada requisito atendido vale.
   - Experiência relevante (25%): cargos, empresas, tempo na área da vaga.
   - Competências técnicas (20%): skills explícitas exigidas vs presentes.
   - Formação (10%): nível compatível com a senioridade da vaga.
   - Outros sinais (5%): idiomas, certificações, etc.
4. Penalize FORTE quando faltar requisito obrigatório explicitado pelo gestor.
5. NÃO penalize por dados pessoais ausentes (CPF, foto, gênero, idade) — protegidos por LGPD.
6. NÃO use proxies discriminatórios: nome, bairro, foto, escola de origem.
7. Sempre devolva via ferramenta "avaliar_aderencia". Nunca texto livre.\
`;

export const AvaliacaoSchema = z.object({
  score: z
    .number()
    .min(0)
    .max(100)
    .describe('Score numérico de aderência (0 a 100).'),
  justificativa: z
    .string()
    .min(20)
    .max(2000)
    .describe(
      'Resumo factual em 3 a 6 frases explicando o score. Sem adjetivos vagos.',
    ),
  pontos_fortes: z.array(z.string().max(300)).max(8).default([]),
  lacunas: z.array(z.string().max(300)).max(8).default([]),
  evidencias: z
    .array(
      z.object({
        eixo: z.enum([
          'requisitos_gestor',
          'experiencia',
          'competencias',
          'formacao',
          'outros',
        ]),
        trecho: z.string().max(400),
        impacto: z.enum(['positivo', 'negativo', 'neutro']),
      }),
    )
    .max(15)
    .default([]),
});
export type Avaliacao = z.infer<typeof AvaliacaoSchema>;

export const RANKING_TOOL_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    score: {
      type: 'number',
      minimum: 0,
      maximum: 100,
      description: 'Score numérico de aderência (0 a 100).',
    },
    justificativa: {
      type: 'string',
      minLength: 20,
      maxLength: 2000,
      description:
        'Resumo factual em 3 a 6 frases explicando o score. Sem adjetivos vagos.',
    },
    pontos_fortes: {
      type: 'array',
      items: { type: 'string', maxLength: 300 },
      maxItems: 8,
    },
    lacunas: {
      type: 'array',
      items: { type: 'string', maxLength: 300 },
      maxItems: 8,
    },
    evidencias: {
      type: 'array',
      maxItems: 15,
      items: {
        type: 'object',
        properties: {
          eixo: {
            type: 'string',
            enum: [
              'requisitos_gestor',
              'experiencia',
              'competencias',
              'formacao',
              'outros',
            ],
          },
          trecho: { type: 'string', maxLength: 400 },
          impacto: {
            type: 'string',
            enum: ['positivo', 'negativo', 'neutro'],
          },
        },
        required: ['eixo', 'trecho', 'impacto'],
      },
    },
  },
  required: ['score', 'justificativa'],
  additionalProperties: false,
} as const;
