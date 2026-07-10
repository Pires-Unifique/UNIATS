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
export const RESPOSTAS_PROMPT_VERSION = 'claude-respostas-v1';

export const RespostaExtraidaSchema = z.object({
  ref: z.string().min(1).max(10),
  status: z.enum(['abordada', 'parcial', 'nao_abordada']),
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
              '"abordada": o candidato respondeu ao que a pergunta quer saber (mesmo que ' +
              'a pergunta não tenha sido feita com essas palavras). "parcial": o tema ' +
              'apareceu mas a resposta não cobre o essencial. "nao_abordada": o tema não ' +
              'apareceu na conversa — na dúvida, use este.',
          },
          sintese: {
            type: 'string',
            maxLength: 1500,
            description:
              'O que o candidato respondeu, em 1-4 frases factuais (português brasileiro), ' +
              'SÓ com base nas falas dele. Omitir quando status = "nao_abordada".',
          },
          citacao: {
            type: 'string',
            maxLength: 2000,
            description:
              'Trecho LITERAL do transcript (fala do candidato) que sustenta a síntese — ' +
              'copie do texto, sem parafrasear. OBRIGATÓRIA quando status = "abordada" ou ' +
              '"parcial"; omitir quando "nao_abordada".',
          },
        },
        required: ['ref', 'status'],
      },
    },
  },
  required: ['respostas'],
  additionalProperties: false,
} as const;
