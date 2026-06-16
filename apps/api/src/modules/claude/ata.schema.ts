import { z } from 'zod';

/**
 * Schema da "ATA" gerada pelo Claude a partir do transcript de uma reunião/
 * entrevista. Saída enxuta, alinhada ao que persistimos:
 *   - resumo  → resumo executivo
 *   - topicos → assuntos discutidos
 *
 * Usado no bake-off de transcrição (mesmo prompt nos dois provedores), então a
 * comparação isola a qualidade da TRANSCRIÇÃO, não do resumo.
 *
 * Versionar ao mudar prompt/shape (igual ao parser de currículo) permite
 * reprocessar transcrições antigas no futuro.
 */
export const ATA_PROMPT_VERSION = 'claude-ata-v1';

export const AtaReuniaoSchema = z.object({
  resumo: z.string().min(1).max(2000),
  topicos: z.array(z.string().min(1)).max(20).default([]),
});

export type AtaReuniao = z.infer<typeof AtaReuniaoSchema>;

/**
 * JSON Schema correspondente — `input_schema` da ferramenta no Claude.
 * Mantido em sincronia manual com o Zod acima.
 */
export const ATA_TOOL_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    resumo: {
      type: 'string',
      maxLength: 2000,
      description:
        'Resumo executivo da reunião em 3 a 6 frases factuais: do que se tratou, ' +
        'principais pontos e desfecho. Sem adjetivos vagos, sem inventar fatos.',
    },
    topicos: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Lista curta de tópicos/assuntos efetivamente discutidos (termos curtos, ' +
        'não frases). Ex.: "Experiência com Node", "Pretensão salarial", "Disponibilidade".',
    },
  },
  required: ['resumo'],
  additionalProperties: false,
} as const;
