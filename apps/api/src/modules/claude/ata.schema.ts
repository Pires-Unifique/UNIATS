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
export const ATA_PROMPT_VERSION = 'claude-ata-v3';

/**
 * Teto do resumo. É uma REDE DE SEGURANÇA, não o alvo: quem controla o tamanho é
 * o orçamento declarado no SYSTEM_PROMPT_ATA (~4.000 chars), porque `maxLength` no
 * input_schema da tool é apenas declarativo — o Claude não o trata como trava.
 *
 * Nem `strict: true` resolveria: constraints de string (minLength/maxLength) estão
 * fora do que o modo estrito valida (ele garante a FORMA do schema, não tamanhos),
 * e os SDKs chegam a removê-las do schema enviado.
 *
 * Estava em 3.000, o que a ATA de uma entrevista real de 1h (≈60k chars de
 * transcript) estourava — e como o Zod valida a saída, o job inteiro caía.
 */
export const ATA_RESUMO_MAX_CHARS = 8000;

export const AtaReuniaoSchema = z.object({
  // Resumo estruturado em seções (Contexto / Assuntos abordados / Relevante para a
  // seleção / Desfecho), com quebras de linha.
  resumo: z.string().min(1).max(ATA_RESUMO_MAX_CHARS),
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
      // Declarativo — o Claude não trata isto como trava. Mantido em sincronia com
      // o Zod para documentar a intenção; a trava real é o Zod, e o controle de
      // fato é o orçamento em caracteres no system prompt.
      maxLength: ATA_RESUMO_MAX_CHARS,
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
