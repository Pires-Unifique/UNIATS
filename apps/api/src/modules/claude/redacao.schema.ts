import { z } from 'zod';

/**
 * Camada 2 da censura LGPD — semântica, via Claude.
 *
 * Recebe os turnos da transcrição (já passados pela Camada 1/regex) e devolve,
 * para CADA turno, o mesmo texto com os DADOS SENSÍVEIS ocultados por marcadores
 * `[OCULTADO: CATEGORIA]`, preservando o resto verbatim. Cobre as categorias que
 * exigem entendimento de contexto (art. 5º, II da LGPD): saúde, origem racial,
 * religião, opinião política, filiação sindical, vida sexual, genético/biométrico
 * — além de identificadores falados que a regex não pega.
 *
 * Versionar ao mudar prompt/shape permite reprocessar transcrições antigas.
 */
export const REDACAO_PROMPT_VERSION = 'claude-redacao-v1';

export const RedacaoSchema = z.object({
  turnos: z
    .array(
      z.object({
        // Ecoa o índice recebido — usado para remontar 1:1 preservando falante/tempo.
        i: z.number().int().nonnegative(),
        // Texto do turno com os dados sensíveis já ocultados. Pode ser só o marcador
        // se o turno inteiro era sensível.
        texto: z.string(),
      }),
    )
    .min(1),
});

export type Redacao = z.infer<typeof RedacaoSchema>;

/** JSON Schema correspondente — `input_schema` da ferramenta no Claude. */
export const REDACAO_TOOL_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    turnos: {
      type: 'array',
      description:
        'Um item para CADA turno recebido, na mesma ordem, ecoando o índice "i".',
      items: {
        type: 'object',
        properties: {
          i: {
            type: 'integer',
            description: 'O índice [n] do turno recebido, copiado exatamente.',
          },
          texto: {
            type: 'string',
            description:
              'O texto do turno com os DADOS SENSÍVEIS substituídos por marcadores ' +
              '[OCULTADO: CATEGORIA]. Todo o resto do turno deve ser copiado LITERALMENTE, ' +
              'sem reescrever, resumir ou traduzir. Se o turno inteiro for sensível, ' +
              'devolva apenas o marcador.',
          },
        },
        required: ['i', 'texto'],
        additionalProperties: false,
      },
    },
  },
  required: ['turnos'],
  additionalProperties: false,
} as const;
