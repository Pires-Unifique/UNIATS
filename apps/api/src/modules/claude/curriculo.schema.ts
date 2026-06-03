import { z } from 'zod';

/**
 * Schema da saída estruturada do parser de currículo via Claude.
 * Mantemos campos opcionais — o currículo "ideal" não existe, e
 * forçar todos os campos faz o LLM alucinar.
 *
 * Versionar o schema é importante: quando alterarmos shape, bump
 * em PARSER_PROMPT_VERSION para reprocessar currículos antigos.
 */

export const ExperienciaSchema = z.object({
  cargo: z.string().min(1),
  empresa: z.string().min(1),
  inicio: z
    .string()
    .regex(/^\d{4}(-\d{2})?$/, 'Use formato YYYY ou YYYY-MM')
    .optional(),
  fim: z
    .union([
      z.string().regex(/^\d{4}(-\d{2})?$/),
      z.literal('atual'),
    ])
    .optional(),
  descricao: z.string().max(2000).optional(),
  tecnologias: z.array(z.string()).optional(),
});

export const FormacaoSchema = z.object({
  curso: z.string().min(1),
  instituicao: z.string().min(1),
  nivel: z
    .enum([
      'tecnico',
      'tecnologo',
      'graduacao',
      'pos-graduacao',
      'mba',
      'mestrado',
      'doutorado',
      'curso-livre',
      'outro',
    ])
    .optional(),
  inicio: z
    .string()
    .regex(/^\d{4}(-\d{2})?$/)
    .optional(),
  fim: z
    .union([z.string().regex(/^\d{4}(-\d{2})?$/), z.literal('atual')])
    .optional(),
});

export const IdiomaSchema = z.object({
  idioma: z.string().min(1),
  nivel: z
    .enum(['basico', 'intermediario', 'avancado', 'fluente', 'nativo'])
    .optional(),
});

export const CertificacaoSchema = z.object({
  nome: z.string().min(1),
  emissor: z.string().optional(),
  ano: z
    .string()
    .regex(/^\d{4}$/, 'Use formato YYYY')
    .optional(),
});

/** Schema final usado tanto para validar a resposta do LLM quanto para o banco. */
export const CurriculoEstruturadoSchema = z.object({
  resumo: z.string().max(800).optional(),
  experiencias: z.array(ExperienciaSchema).default([]),
  formacoes: z.array(FormacaoSchema).default([]),
  competencias: z.array(z.string().min(1)).default([]),
  idiomas: z.array(IdiomaSchema).default([]),
  certificacoes: z.array(CertificacaoSchema).default([]),
  anos_experiencia: z.number().nonnegative().max(70).optional(),
});

export type CurriculoEstruturado = z.infer<typeof CurriculoEstruturadoSchema>;

/**
 * JSON Schema correspondente — usado como `input_schema` da ferramenta no Claude.
 * Mantém-se em sincronia manual com o Zod; um teste de coerência valida isso.
 */
export const CURRICULO_TOOL_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    resumo: {
      type: 'string',
      maxLength: 800,
      description: 'Resumo profissional em 2-4 frases.',
    },
    experiencias: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          cargo: { type: 'string' },
          empresa: { type: 'string' },
          inicio: {
            type: 'string',
            pattern: '^\\d{4}(-\\d{2})?$',
            description: 'YYYY ou YYYY-MM',
          },
          fim: {
            type: 'string',
            description: 'YYYY, YYYY-MM ou "atual"',
          },
          descricao: { type: 'string', maxLength: 2000 },
          tecnologias: { type: 'array', items: { type: 'string' } },
        },
        required: ['cargo', 'empresa'],
      },
    },
    formacoes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          curso: { type: 'string' },
          instituicao: { type: 'string' },
          nivel: {
            type: 'string',
            enum: [
              'tecnico',
              'tecnologo',
              'graduacao',
              'pos-graduacao',
              'mba',
              'mestrado',
              'doutorado',
              'curso-livre',
              'outro',
            ],
          },
          inicio: { type: 'string', pattern: '^\\d{4}(-\\d{2})?$' },
          fim: { type: 'string' },
        },
        required: ['curso', 'instituicao'],
      },
    },
    competencias: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Lista de skills/competências técnicas e comportamentais distintas.',
    },
    idiomas: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          idioma: { type: 'string' },
          nivel: {
            type: 'string',
            enum: [
              'basico',
              'intermediario',
              'avancado',
              'fluente',
              'nativo',
            ],
          },
        },
        required: ['idioma'],
      },
    },
    certificacoes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          nome: { type: 'string' },
          emissor: { type: 'string' },
          ano: { type: 'string', pattern: '^\\d{4}$' },
        },
        required: ['nome'],
      },
    },
    anos_experiencia: {
      type: 'number',
      minimum: 0,
      maximum: 70,
      description:
        'Estimativa total em anos. Some intervalos sem sobrepor experiências paralelas.',
    },
  },
  required: ['experiencias', 'competencias'],
  additionalProperties: false,
} as const;
