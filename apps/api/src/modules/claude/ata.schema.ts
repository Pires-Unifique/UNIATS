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
export const ATA_PROMPT_VERSION = 'claude-ata-v2';

export const AtaReuniaoSchema = z.object({
  // Resumo estruturado em seções (Contexto / Assuntos abordados / Relevante para a
  // seleção / Desfecho), com quebras de linha. Limite ampliado p/ acomodar a
  // estrutura e a citação explícita do que NÃO foi abordado.
  resumo: z.string().min(1).max(3000),
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
      maxLength: 3000,
      description:
        'Resumo executivo ESTRUTURADO em seções rotuladas (texto puro, sem markdown), ' +
        'com uma linha em branco entre elas: "Contexto:" (participantes, caráter da ' +
        'conversa, objetivo), "Assuntos abordados:" (o que foi conversado, em ordem), ' +
        '"Relevante para a seleção:" (eixos de entrevista — experiência, motivação, ' +
        'disponibilidade, pretensão, fit — citando explicitamente os que NÃO foram ' +
        'abordados; omitir se não for entrevista) e "Desfecho:" (decisão/próximo passo, ' +
        'ou que não houve). Factual, sem adjetivos vagos e sem inventar nada fora do transcript.',
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
