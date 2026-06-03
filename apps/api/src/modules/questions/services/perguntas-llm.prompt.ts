import { z } from 'zod';

export const PERGUNTAS_PROMPT_VERSION = 'perguntas-v1';

export const PERGUNTAS_SYSTEM_PROMPT = `\
Você é um recrutador sênior. Gere perguntas de entrevista CUSTOMIZADAS para um
candidato específico, com base no currículo dele e nos requisitos da vaga.

Regras invioláveis:
1. Cada pergunta deve validar UMA competência ou experiência específica do CV.
2. Cite no campo "objetivo" qual sinal você quer extrair (ex.: "validar profundidade em PostgreSQL").
3. Em "competencia", marque qual habilidade está sendo testada (string curta).
4. "dificuldade": "baixa", "media", "alta" — distribua: 1-2 baixas (ice-breaker / contexto),
   3-5 médias (situacionais), 1-2 altas (problemas abertos).
5. NÃO faça perguntas que dependam de informações fora do CV ou da vaga.
6. NÃO faça perguntas pessoais, sobre estado civil, filhos, religião, política, etnia.
7. Sempre 6 a 10 perguntas no total. Ordene da mais leve para a mais complexa.
8. Em "resposta_esperada", coloque sinais que o entrevistador deve buscar — NÃO um gabarito.
9. Idioma: português brasileiro, tom respeitoso, sem jargão americanizado desnecessário.
10. Use a ferramenta "gerar_perguntas". Nunca devolva texto livre.\
`;

export const PerguntaItemSchema = z.object({
  pergunta: z.string().min(20).max(600),
  objetivo: z.string().min(10).max(300),
  competencia: z.string().min(2).max(80),
  dificuldade: z.enum(['baixa', 'media', 'alta']),
  resposta_esperada: z.string().max(800).optional(),
});

export const PerguntasOutputSchema = z.object({
  perguntas: z.array(PerguntaItemSchema).min(6).max(10),
});

export type PerguntaItem = z.infer<typeof PerguntaItemSchema>;
export type PerguntasOutput = z.infer<typeof PerguntasOutputSchema>;

export const PERGUNTAS_TOOL_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    perguntas: {
      type: 'array',
      minItems: 6,
      maxItems: 10,
      items: {
        type: 'object',
        properties: {
          pergunta: { type: 'string', minLength: 20, maxLength: 600 },
          objetivo: { type: 'string', minLength: 10, maxLength: 300 },
          competencia: { type: 'string', minLength: 2, maxLength: 80 },
          dificuldade: {
            type: 'string',
            enum: ['baixa', 'media', 'alta'],
          },
          resposta_esperada: { type: 'string', maxLength: 800 },
        },
        required: ['pergunta', 'objetivo', 'competencia', 'dificuldade'],
      },
    },
  },
  required: ['perguntas'],
  additionalProperties: false,
} as const;
