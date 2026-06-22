import { z } from 'zod';

/**
 * Schema da saída estruturada do OCR de RG (documento de identidade BR) via
 * Claude visão. Todos os campos são opcionais — o objetivo é extrair o que
 * está LEGÍVEL no documento, sem inventar. O dado é tratado como
 * "extraído por IA, conferir" — nunca verdade automática.
 *
 * Versionar é importante: ao mudar shape/instruções, bump RG_PROMPT_VERSION
 * (gravado em DocumentoAdmissional.ocr_versao) para reprocessar documentos
 * antigos.
 */

export const FiliacaoSchema = z.object({
  pai: z.string().min(1).optional(),
  mae: z.string().min(1).optional(),
});

/** Schema final — valida a resposta do LLM e o que vai para o banco. */
export const RgExtraidoSchema = z.object({
  // Nome completo EXATAMENTE como impresso no documento — é o campo crítico
  // para a criação do usuário de AD.
  nome_completo: z.string().min(1).max(200).optional(),
  rg_numero: z.string().min(1).max(40).optional(),
  orgao_emissor: z.string().min(1).max(40).optional(), // ex.: SSP, SESP, DETRAN
  uf: z
    .string()
    .regex(/^[A-Z]{2}$/, 'UF deve ter 2 letras maiúsculas')
    .optional(),
  data_nascimento: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use formato YYYY-MM-DD')
    .optional(),
  data_expedicao: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use formato YYYY-MM-DD')
    .optional(),
  filiacao: FiliacaoSchema.optional(),
  // O RG às vezes traz o CPF impresso; só preencher se estiver no documento.
  cpf: z
    .string()
    .regex(/^\d{11}$/, 'CPF deve ter 11 dígitos (só números)')
    .optional(),
  naturalidade: z.string().min(1).max(120).optional(),
  // Sinaliza qualidade do OCR para a equipe priorizar conferência manual.
  confianca: z.enum(['alta', 'media', 'baixa']).optional(),
});

export type RgExtraido = z.infer<typeof RgExtraidoSchema>;

/**
 * JSON Schema correspondente — usado como `input_schema` da ferramenta no Claude.
 * Mantém-se em sincronia manual com o Zod acima.
 */
export const RG_TOOL_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    nome_completo: {
      type: 'string',
      maxLength: 200,
      description:
        'Nome completo EXATAMENTE como impresso no documento, com a mesma grafia e acentuação. Não corrija, não abrevie.',
    },
    rg_numero: {
      type: 'string',
      maxLength: 40,
      description: 'Número do RG/registro geral, como impresso (pode conter pontos/traço).',
    },
    orgao_emissor: {
      type: 'string',
      maxLength: 40,
      description: 'Órgão expedidor (ex.: SSP, SESP, DETRAN, PC).',
    },
    uf: {
      type: 'string',
      pattern: '^[A-Z]{2}$',
      description: 'UF do órgão emissor, 2 letras maiúsculas (ex.: SC, SP).',
    },
    data_nascimento: {
      type: 'string',
      pattern: '^\\d{4}-\\d{2}-\\d{2}$',
      description: 'Data de nascimento no formato YYYY-MM-DD.',
    },
    data_expedicao: {
      type: 'string',
      pattern: '^\\d{4}-\\d{2}-\\d{2}$',
      description: 'Data de expedição no formato YYYY-MM-DD.',
    },
    filiacao: {
      type: 'object',
      properties: {
        pai: { type: 'string' },
        mae: { type: 'string' },
      },
      description: 'Filiação (pai/mãe) como impressa. Omita o que não estiver legível.',
    },
    cpf: {
      type: 'string',
      pattern: '^\\d{11}$',
      description: 'CPF (11 dígitos, só números) APENAS se estiver impresso no documento.',
    },
    naturalidade: {
      type: 'string',
      maxLength: 120,
      description: 'Naturalidade/cidade-UF de nascimento, se impressa.',
    },
    confianca: {
      type: 'string',
      enum: ['alta', 'media', 'baixa'],
      description:
        'Sua confiança geral na leitura: "alta" (nítido), "media" (parcial), "baixa" (imagem ruim/ilegível).',
    },
  },
  required: [],
  additionalProperties: false,
} as const;

/** Bump ao alterar instruções/shape — grava em DocumentoAdmissional.ocr_versao. */
export const RG_PROMPT_VERSION = 'claude-rg-v1';
