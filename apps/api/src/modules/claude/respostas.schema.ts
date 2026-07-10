import { z } from 'zod';

/**
 * Schema da ANÁLISE DE RESPOSTAS: o Claude confronta o roteiro de perguntas
 * (vaga/entrevista + banco padrão do DHO) com o texto final de falas da
 * reunião e devolve, POR PERGUNTA, se foi abordada e o que o candidato
 * respondeu — sempre ancorado numa citação literal do transcript.
 *
 * `ref` ecoa o identificador curto ("P1", "P2"…) enviado no prompt; o service
 * mapeia de volta para o id real da pergunta. Versionar ao mudar prompt/shape
 * (igual ao parser/ata) permite reanalisar entrevistas antigas.
 */
export const RESPOSTAS_PROMPT_VERSION = 'claude-respostas-v2';

export const RespostaExtraidaSchema = z.object({
  ref: z.string().min(1).max(10),
  /** O CANDIDATO respondeu? */
  status: z.enum(['abordada', 'parcial', 'nao_abordada']),
  /** O tema apareceu na conversa, por QUALQUER participante? */
  tema_abordado: z.boolean().optional(),
  falante: z.string().max(120).optional(),
  sintese: z.string().max(1500).optional(),
  citacao: z.string().max(2000).optional(),
});

export const RespostasExtraidasSchema = z.object({
  respostas: z.array(RespostaExtraidaSchema).min(1).max(60),
});

export type RespostaExtraida = z.infer<typeof RespostaExtraidaSchema>;
export type RespostasExtraidas = z.infer<typeof RespostasExtraidasSchema>;

/**
 * JSON Schema correspondente — `input_schema` da ferramenta no Claude.
 * Mantido em sincronia manual com o Zod acima.
 */
export const RESPOSTAS_TOOL_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    respostas: {
      type: 'array',
      minItems: 1,
      maxItems: 60,
      items: {
        type: 'object',
        properties: {
          ref: {
            type: 'string',
            maxLength: 10,
            description:
              'Identificador da pergunta EXATAMENTE como recebido (ex.: "P3").',
          },
          status: {
            type: 'string',
            enum: ['abordada', 'parcial', 'nao_abordada'],
            description:
              'O CANDIDATO respondeu? "abordada": o candidato respondeu ao que a pergunta ' +
              'quer saber (mesmo que ela não tenha sido feita com essas palavras). "parcial": ' +
              'o candidato tocou no tema mas não cobriu o essencial. "nao_abordada": o ' +
              'candidato não respondeu — na dúvida, use este.',
          },
          tema_abordado: {
            type: 'boolean',
            description:
              'true se o CONTEÚDO da pergunta apareceu na conversa dito por QUALQUER ' +
              'participante (inclusive o entrevistador). Sempre true quando status = ' +
              '"abordada"/"parcial". Pode ser true com status "nao_abordada": o tema foi ' +
              'tratado, mas não pelo candidato.',
          },
          falante: {
            type: 'string',
            maxLength: 120,
            description:
              'Nome de QUEM tratou do tema, exatamente como aparece no transcript. ' +
              'Obrigatório quando tema_abordado = true; omitir quando false.',
          },
          sintese: {
            type: 'string',
            maxLength: 1500,
            description:
              'O que foi dito sobre o tema, em 1-4 frases factuais (português brasileiro), ' +
              'SÓ com base nas falas do "falante". Se não foi o candidato que falou, deixe ' +
              'isso explícito na primeira frase. Omitir quando tema_abordado = false.',
          },
          citacao: {
            type: 'string',
            maxLength: 2000,
            description:
              'Trecho LITERAL do transcript (fala do "falante") que sustenta a síntese — ' +
              'copie do texto, sem parafrasear. OBRIGATÓRIA quando tema_abordado = true; ' +
              'omitir quando false.',
          },
        },
        required: ['ref', 'status', 'tema_abordado'],
      },
    },
  },
  required: ['respostas'],
  additionalProperties: false,
} as const;
