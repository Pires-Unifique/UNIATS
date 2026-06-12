/**
 * Schemas Zod que descrevem os payloads vindos da Gupy.
 *
 * Princípios:
 * - SEMPRE usar `.passthrough()` para não rejeitar campos novos que a Gupy
 *   adicionar no futuro — apenas validamos o que de fato consumimos.
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
          })
          .passthrough(),
      )
      .optional()
      .nullable(),
  })
  .passthrough();

export type VagaGupy = z.infer<typeof VagaGupySchema>;

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
    birthdate: z.string().optional().nullable(),
    gender: z.string().optional().nullable(),
    city: z.string().optional().nullable(),
    state: z.string().optional().nullable(),
    // Endereço (vem com fields=all).
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
          })
          .passthrough(),
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
          })
          .passthrough(),
      )
      .optional()
      .nullable(),
    areasOfInterest: z.array(z.unknown()).optional().nullable(),
  })
  .passthrough();

export type CandidatoGupy = z.infer<typeof CandidatoGupySchema>;

export const CandidaturaGupySchema = z
  .object({
    id: idGupy,
    // jobId não vem no item de application; a Gupy manda um objeto `job`.
    jobId: idGupy.optional().nullable(),
    job: z
      .object({ id: idGupy.optional().nullable(), name: z.string().optional() })
      .passthrough()
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
  })
  .passthrough();

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
