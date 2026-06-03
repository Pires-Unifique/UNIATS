import { z } from 'zod';

/**
 * Prompt + schema para análise qualitativa do tom de voz do candidato.
 *
 * IMPORTANTE: Este NÃO é um classificador "se contrata ou não". É uma observação
 * descritiva sobre o tom da fala — confiança, hesitação, entusiasmo — que vai
 * ajudar o recrutador a relembrar a entrevista. NUNCA usar como critério único
 * de decisão (LGPD Art. 20: decisões automatizadas exigem revisão humana).
 */

export const VOICE_PROMPT_VERSION = 'voice-analysis-v1';

export const VOICE_SYSTEM_PROMPT = `\
Você é um analista de comunicação. Recebe a transcrição (com diarização e
sentimento por trecho) de uma entrevista de emprego e produz observações
descritivas e factuais sobre o tom de voz do CANDIDATO (não do entrevistador).

REGRAS:
1. Foque APENAS no falante identificado como candidato (geralmente "speaker B" ou
   o speaker com mais turnos longos — use seu julgamento).
2. NÃO infira traços de personalidade nem aptidão para o cargo.
3. NÃO comente sobre sotaque, gênero, idade aparente, origem regional, nome, etnia.
4. Avalie em escala 0-1:
   - confianca: ritmo estável, frases completas, vocabulário preciso.
   - nervosismo: muitas hesitações, autocorreções, frases incompletas.
   - entusiasmo: variação prosódica (inferida dos sentimentos POSITIVE), engajamento.
5. Cite EVIDÊNCIAS literais da transcrição (trechos entre aspas, ≤ 200 chars cada).
6. Em "observacoes": 3 a 6 frases factuais. Não use adjetivos vagos.
7. Sempre devolva via ferramenta "analisar_tom_de_voz".\
`;

export const AnaliseVozLLMSchema = z.object({
  confianca: z.number().min(0).max(1),
  nervosismo: z.number().min(0).max(1),
  entusiasmo: z.number().min(0).max(1),
  observacoes: z.string().min(20).max(2000),
  evidencias: z
    .array(
      z.object({
        trecho: z.string().max(300),
        aspecto: z.enum(['confianca', 'nervosismo', 'entusiasmo']),
      }),
    )
    .max(10)
    .default([]),
});
export type AnaliseVozLLM = z.infer<typeof AnaliseVozLLMSchema>;

export const VOICE_TOOL_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    confianca: { type: 'number', minimum: 0, maximum: 1 },
    nervosismo: { type: 'number', minimum: 0, maximum: 1 },
    entusiasmo: { type: 'number', minimum: 0, maximum: 1 },
    observacoes: { type: 'string', minLength: 20, maxLength: 2000 },
    evidencias: {
      type: 'array',
      maxItems: 10,
      items: {
        type: 'object',
        properties: {
          trecho: { type: 'string', maxLength: 300 },
          aspecto: {
            type: 'string',
            enum: ['confianca', 'nervosismo', 'entusiasmo'],
          },
        },
        required: ['trecho', 'aspecto'],
      },
    },
  },
  required: ['confianca', 'nervosismo', 'entusiasmo', 'observacoes'],
  additionalProperties: false,
} as const;
