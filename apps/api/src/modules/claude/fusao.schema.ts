import { z } from 'zod';

/**
 * Schema da "fusão" — o Claude reconcilia DUAS transcrições da mesma reunião
 * (Teams diarizado × Whisper PT) numa versão final, a melhor possível.
 *
 * Versionar ao mudar prompt/shape permite reprocessar fusões antigas no futuro.
 */
export const FUSAO_PROMPT_VERSION = 'claude-fusao-v1';

export const FusaoTranscricaoSchema = z.object({
  turnos: z
    .array(
      z.object({
        falante: z.string().min(1),
        texto: z.string().min(1),
      }),
    )
    .min(1),
});

export type FusaoTranscricao = z.infer<typeof FusaoTranscricaoSchema>;

/** JSON Schema correspondente — `input_schema` da ferramenta no Claude. */
export const FUSAO_TOOL_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    turnos: {
      type: 'array',
      description:
        'A transcrição final reconciliada, em ordem cronológica, um item por ' +
        'turno de fala (junte falas consecutivas do mesmo falante).',
      items: {
        type: 'object',
        properties: {
          falante: {
            type: 'string',
            description:
              'Nome do falante (vindo da transcrição A/Teams). Use "Desconhecido" ' +
              'apenas se nenhuma das fontes identificar quem falou.',
          },
          texto: {
            type: 'string',
            description:
              'A melhor versão do que foi dito nesse turno, em português — sem ' +
              'inventar nada que não esteja em A ou B.',
          },
        },
        required: ['falante', 'texto'],
        additionalProperties: false,
      },
    },
  },
  required: ['turnos'],
  additionalProperties: false,
} as const;
