/**
 * Schemas Zod que descrevem os payloads vindos da Gupy.
 *
 * Princípios:
 * - **ALLOWLIST, não passthrough.** Estes schemas descartam todo campo que não
 *   esteja declarado aqui. Com `?fields=all` a Gupy devolve o cadastro completo
 *   do candidato — inclusive dado sensível do art. 5º II da LGPD (deficiência =
 *   saúde, raça/cor, identidade de gênero, orientação sexual) e identificadores
 *   que a triagem não usa (CPF, data de nascimento, endereço completo). Com
 *   `.passthrough()` tudo isso sobrevivia à validação e ia para o banco.
 *   Descartar no parse é a única barreira que garante que esse dado não circula
 *   pelo resto do sistema (fila, log, prompt de IA, JSON de resposta).
 * - Consequência aceita: campo NOVO da Gupy é ignorado até alguém declará-lo
 *   aqui. Isso é minimização (art. 6º III) — coletar por precaução é o que a lei
 *   proíbe. Se precisar de um campo, adicione-o explicitamente.
 * - Datas chegam como ISO-8601 string; convertemos no parser final.
 * - IDs da Gupy podem ser number ou string dependendo da rota; normalizamos para bigint.
 */
import { z } from 'zod';

const idGupy = z.union([z.number().int().positive(), z.string().regex(/^\d+$/)])
  .transform((v) => BigInt(v));

export const VagaGupySchema = z
  .object({
    id: idGupy,
    code: z.string().optional().nullable(),
    name: z.string(),
    // Conteúdo preenchido pelo gestor/DHO (vem com ?fields=all). Em geral HTML.
    description: z.string().optional().nullable(),
    responsibilities: z.string().optional().nullable(),
    prerequisites: z.string().optional().nullable(),
    additionalInformation: z.string().optional().nullable(),
    // Critérios de avaliação definidos na vaga (sinal para ranking).
    jobRatingCriterias: z.array(z.unknown()).optional().nullable(),
    // Responsáveis pela vaga (a Gupy envia nome + e-mail de gestor e recrutador).
    managerName: z.string().optional().nullable(),
    managerEmail: z.string().optional().nullable(),
    recruiterName: z.string().optional().nullable(),
    recruiterEmail: z.string().optional().nullable(),
    // Formas aninhada (API antiga/fictícia) e plana (API real) de depto/filial.
    department: z
      .object({ name: z.string().optional() })
      .partial()
      .optional()
      .nullable(),
    branch: z
      .object({ name: z.string().optional() })
      .partial()
      .optional()
      .nullable(),
    departmentName: z.string().optional().nullable(),
    branchName: z.string().optional().nullable(),
    // Localização: a API real manda como addressCity/addressState; as formas
    // city/state são da API antiga/fictícia. addressStateShortName = "SC".
    city: z.string().optional().nullable(),
    state: z.string().optional().nullable(),
    addressCity: z.string().optional().nullable(),
    addressState: z.string().optional().nullable(),
    addressStateShortName: z.string().optional().nullable(),
    type: z.string().optional().nullable(),
    isRemoteWork: z.boolean().optional().nullable(),
    remoteWorking: z.boolean().optional().nullable(),
    status: z.string().optional().nullable(),
    publishedDate: z.string().optional().nullable(),
    publishedAt: z.string().optional().nullable(),
    closingDate: z.string().optional().nullable(),
    // Campos customizados — estrutura genérica
    customFields: z
      .array(
        z
          .object({
            id: z.union([z.string(), z.number()]).optional(),
            title: z.string().optional(),
            // Com fields=all, value pode ser string, número, boolean, array ou objeto.
            value: z.unknown().optional(),
          }),
      )
      .optional()
      .nullable(),
  });

export type VagaGupy = z.infer<typeof VagaGupySchema>;

/**
 * Candidato — SOMENTE o essencial para conduzir um processo seletivo:
 * identificação, contato para falar com a pessoa, localidade (para vaga
 * presencial) e o perfil profissional que alimenta a triagem.
 *
 * Deliberadamente FORA daqui (a Gupy manda, nós descartamos):
 * - `birthdate` — idade não é critério de triagem e habilita discriminação.
 * - `gender`, raça/cor, identidade de gênero, orientação sexual — art. 5º II;
 *   a Gupy coleta para relatório de diversidade DELA, não para a nossa decisão.
 * - deficiência/PCD — dado de SAÚDE, o mais sensível do conjunto.
 * - CPF e documentos — só entram na ADMISSÃO, com base legal própria e por
 *   outro caminho (ver módulo admissao).
 * - endereço completo (rua/número/CEP) — cidade e estado bastam.
 */
export const CandidatoGupySchema = z
  .object({
    id: idGupy,
    name: z.string(),
    lastName: z.string().optional().nullable(),
    // email/url sem validação estrita: a Gupy às vezes manda valores parciais.
    email: z.string().optional().nullable(),
    phone: z.string().optional().nullable(),
    mobileNumber: z.string().optional().nullable(),
    phoneNumber: z.string().optional().nullable(),
    linkedinUrl: z.string().optional().nullable(),
    linkedinProfileUrl: z.string().optional().nullable(),
    city: z.string().optional().nullable(),
    state: z.string().optional().nullable(),
    // Localidade apenas em nível de cidade/estado — sem rua, número ou CEP.
    addressCity: z.string().optional().nullable(),
    addressState: z.string().optional().nullable(),
    addressStateShortName: z.string().optional().nullable(),
    // Perfil estruturado (vem com fields=all) — insumo do ranking.
    workExperience: z
      .array(
        z
          .object({
            role: z.string().optional().nullable(),
            companyName: z.string().optional().nullable(),
            activitiesPerformed: z.string().optional().nullable(),
            startMonth: z.number().optional().nullable(),
            startYear: z.number().optional().nullable(),
            endMonth: z.number().optional().nullable(),
            endYear: z.number().optional().nullable(),
          }),
      )
      .optional()
      .nullable(),
    schooling: z.unknown().optional().nullable(),
    schoolingStatus: z.string().optional().nullable(),
    languages: z
      .array(
        z
          .object({
            language: z.string().optional().nullable(),
            level: z.string().optional().nullable(),
          }),
      )
      .optional()
      .nullable(),
    // Tolerante a item não-string (a Gupy varia o formato aqui): o mapper
    // aproveita só as strings. Tipar como z.string() rejeitaria a candidatura
    // inteira por causa de um elemento inesperado — troca ruim.
    areasOfInterest: z.array(z.unknown()).optional().nullable(),
  });

export type CandidatoGupy = z.infer<typeof CandidatoGupySchema>;

export const CandidaturaGupySchema = z
  .object({
    id: idGupy,
    // jobId não vem no item de application; a Gupy manda um objeto `job`.
    jobId: idGupy.optional().nullable(),
    job: z
      .object({ id: idGupy.optional().nullable(), name: z.string().optional() })
      .optional()
      .nullable(),
    candidate: CandidatoGupySchema,
    currentStep: z
      .object({ name: z.string().optional(), status: z.string().optional() })
      .partial()
      .optional()
      .nullable(),
    status: z.string().optional().nullable(),
    score: z.number().optional().nullable(),
    disqualifiedReason: z.string().optional().nullable(),
    // datas como string simples (formatos variam); convertidas no mapper.
    appliedAt: z.string().optional().nullable(),
    createdAt: z.string().optional().nullable(),
    movedAt: z.string().optional().nullable(),
    updatedAt: z.string().optional().nullable(),
    resumeUrl: z.string().optional().nullable(),
    // NÃO declarar aqui as respostas do candidato ao formulário da vaga
    // (`applicationAnswers`/`customFields` da candidatura): perguntas de
    // diversidade e de saúde entram por esse caminho. Se algum dia forem
    // necessárias, filtre pergunta por pergunta — nunca o bloco inteiro.
  });

export type CandidaturaGupy = z.infer<typeof CandidaturaGupySchema>;

// Etapa (step) de uma vaga. Necessária para descobrir o `currentStepId`
// usado ao mover uma candidatura entre etapas.
export const EtapaGupySchema = z
  .object({
    id: idGupy,
    name: z.string(),
    // online | offline | registration | hiring | pre_hiring
    type: z.string().optional().nullable(),
    category: z.string().optional().nullable(),
    endDate: z.string().optional().nullable(),
    createdAt: z.string().optional().nullable(),
    updatedAt: z.string().optional().nullable(),
  })
  .passthrough();

export type EtapaGupy = z.infer<typeof EtapaGupySchema>;

// ---------------------------------------------------------------------
// ESCRITA — criação/publicação de vaga e estrutura organizacional
// ---------------------------------------------------------------------

/**
 * Resposta da criação de vaga (POST /api/v1/jobs). A Gupy devolve a vaga
 * recém-criada (sempre em rascunho). Validamos apenas o `id` — o resto fica
 * sob passthrough porque o shape completo varia por tenant/versão.
 */
export const VagaCriadaGupySchema = z
  .object({
    id: idGupy,
    code: z.string().optional().nullable(),
    name: z.string().optional().nullable(),
    status: z.string().optional().nullable(),
  })
  .passthrough();

export type VagaCriadaGupy = z.infer<typeof VagaCriadaGupySchema>;

/**
 * Item de estrutura organizacional (departamento, cargo/role ou filial/branch)
 * vindo da API `/os/v1/*`. Os nomes de campo divergem entre recursos/versões,
 * então aceitamos várias chaves e normalizamos no client.
 */
export const EstruturaItemGupySchema = z
  .object({
    id: z.union([z.number(), z.string()]).optional().nullable(),
    uuid: z.string().optional().nullable(),
    code: z.union([z.number(), z.string()]).optional().nullable(),
    name: z.string().optional().nullable(),
    description: z.string().optional().nullable(),
  })
  .passthrough();

export type EstruturaItemGupy = z.infer<typeof EstruturaItemGupySchema>;

/**
 * Paginação da API de estrutura organizacional (`/os/v1`). Ela usa a chave
 * `data` (e não `results` como a API de R&S). Normalizamos para `{ data }`.
 */
export const PaginacaoEstruturaGupySchema = <T extends z.ZodTypeAny>(item: T) =>
  z
    .object({
      data: z.array(item).optional(),
      results: z.array(item).optional(),
      page: z.number().int().nonnegative().optional(),
      summary: z.unknown().optional(),
    })
    .passthrough()
    .transform((r) => ({ data: r.data ?? r.results ?? [] }));

// Resposta paginada da Gupy.
// A API real (api.gupy.io/api/v1) devolve { results, totalResults, page, totalPages }.
// Normalizamos para { data, meta } para manter a interface usada pelos call sites.
export const PaginacaoGupySchema = <T extends z.ZodTypeAny>(item: T) =>
  z
    .object({
      results: z.array(item),
      totalResults: z.number().int().nonnegative().optional(),
      page: z.number().int().nonnegative().optional(),
      totalPages: z.number().int().nonnegative().optional(),
    })
    .passthrough()
    .transform((r) => ({
      data: r.results,
      meta: {
        total: r.totalResults,
        page: r.page,
        totalPages: r.totalPages,
      },
    }));
