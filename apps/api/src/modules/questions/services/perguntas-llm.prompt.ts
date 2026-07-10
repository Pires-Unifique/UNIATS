import { z } from 'zod';

export const PERGUNTAS_PROMPT_VERSION = 'perguntas-v4';

export const PERGUNTAS_SYSTEM_PROMPT = `\
Você é um recrutador sênior. Gere perguntas de entrevista CUSTOMIZADAS para um
candidato específico, CRUZANDO o currículo dele com os requisitos da vaga.

Antes de escrever, raciocine (NÃO exponha esse raciocínio na saída):
- Quais requisitos/responsabilidades da vaga o CV JÁ comprova? → vale aprofundar para
  medir a senioridade real, e não só confirmar que a pessoa "tem".
- Quais requisitos da vaga o CV NÃO demonstra (lacunas)? → vale sondar se o candidato
  tem aquilo, sem assumir que não tem.
- O que a vaga trata como obrigatório/crítico? → tem prioridade sobre o desejável.

Regras invioláveis:
1. Toda pergunta deve estar ancorada na VAGA: ou aprofunda uma competência exigida pela
   vaga que o CV comprova, ou investiga um requisito da vaga que o CV ainda NÃO demonstra.
2. Pelo menos 1/3 das perguntas devem mirar LACUNAS — requisitos da vaga não comprovados
   no CV — para descobrir se o candidato os possui, sem dar como certo que não.
3. Priorize os requisitos obrigatórios/críticos da vaga antes dos desejáveis.
4. No campo "objetivo", diga qual sinal você quer extrair E a qual requisito ou
   responsabilidade da vaga a pergunta se conecta
   (ex.: "validar profundidade em PostgreSQL — cobre o requisito 'banco relacional' da vaga").
5. Em "competencia", marque qual habilidade está sendo testada (string curta).
6. "dificuldade": "baixa", "media", "alta" — distribua: 1-2 baixas (ice-breaker / contexto),
   3-5 médias (situacionais), 1-2 altas (problemas abertos).
7. NÃO invente requisitos nem informações: use apenas o que está na vaga e no CV. Se a vaga
   trouxer poucos requisitos explícitos, baseie-se no título e na descrição dela.
8. NÃO faça perguntas pessoais, sobre estado civil, filhos, religião, política, etnia.
9. QUANTIDADE: o roteiro FINAL da entrevista (perguntas já cadastradas pelo time +
   as suas) deve ficar com ~8 a 10 perguntas. Sem perguntas cadastradas, gere de 6 a 10.
   Com perguntas cadastradas, gere APENAS o que falta para complementar (pode ser 1 ou 2)
   — nunca infle o roteiro para bater um número. Ordene da mais leve para a mais complexa.
10. Em "resposta_esperada", coloque sinais que o entrevistador deve buscar — NÃO um gabarito.
11. Idioma: português brasileiro, tom respeitoso, sem jargão americanizado desnecessário.
12. Se houver um bloco <perguntas_ja_cadastradas>, são perguntas que o time JÁ VAI FAZER
    nesta entrevista: NÃO as repita nem gere variações próximas — gere perguntas que as
    COMPLEMENTEM, cobrindo requisitos/lacunas que elas ainda não cobrem.
13. Use a ferramenta "gerar_perguntas". Nunca devolva texto livre.\
`;

export const PerguntaItemSchema = z.object({
  pergunta: z.string().min(20).max(600),
  objetivo: z.string().min(10).max(300),
  competencia: z.string().min(2).max(80),
  dificuldade: z.enum(['baixa', 'media', 'alta']),
  resposta_esperada: z.string().max(800).optional(),
});

export const PerguntasOutputSchema = z.object({
  perguntas: z.array(PerguntaItemSchema).min(1).max(10),
});

export type PerguntaItem = z.infer<typeof PerguntaItemSchema>;
export type PerguntasOutput = z.infer<typeof PerguntasOutputSchema>;

export const PERGUNTAS_TOOL_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    perguntas: {
      type: 'array',
      minItems: 1,
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
