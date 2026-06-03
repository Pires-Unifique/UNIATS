/**
 * Contratos do fluxo "Importar template de vaga (DHO) → publicar na Gupy".
 *
 * Três blocos:
 *  - TemplateVagaParsed  → saída do parser do .xlsx (etapa A: importar).
 *  - OpcaoEstrutura      → opções de departamento/cargo/filial vindas da Gupy
 *                          (etapa B: revisar — selects assíncronos).
 *  - PublicarVagaInput   → payload enviado pelo frontend (etapa C: publicar).
 *
 * Mantidos como Zod para validar dos dois lados (NestJS valida o corpo;
 * o frontend pode validar a resposta do parser).
 */
import { z } from 'zod';

/** Grau de domínio de um conhecimento específico (B/I/A). */
export const GrauConhecimentoSchema = z.enum(['B', 'I', 'A']);
export type GrauConhecimento = z.infer<typeof GrauConhecimentoSchema>;

/** Nível do cargo extraído do template (JR/PL/SR). */
export const NivelCargoSchema = z.enum(['JR', 'PL', 'SR']);
export type NivelCargo = z.infer<typeof NivelCargoSchema>;

export const ConhecimentoEspecificoSchema = z.object({
  texto: z.string(),
  /** Grau marcado com "X" na grade B/I/A; null quando o parser não detectou. */
  grau: GrauConhecimentoSchema.nullable().default(null),
  /** Rótulo de nível ao lado da competência (JR/PL/SR), quando presente. */
  nivel: NivelCargoSchema.nullable().default(null),
});
export type ConhecimentoEspecifico = z.infer<typeof ConhecimentoEspecificoSchema>;

/**
 * Resultado da leitura do template padrão "Descrição do Cargo".
 * Campos ausentes no arquivo NÃO quebram o parser — viram `null`/`[]` e o
 * motivo é registrado em `avisos` para o líder corrigir no formulário.
 */
export const TemplateVagaParsedSchema = z.object({
  titulo: z.string().nullable().default(null),
  departamentoNome: z.string().nullable().default(null),
  missao: z.string().nullable().default(null),
  formacaoMinima: z.string().nullable().default(null),
  formacaoIdeal: z.string().nullable().default(null),
  conhecimentos: z.array(ConhecimentoEspecificoSchema).default([]),
  responsabilidades: z.array(z.string()).default([]),
  autonomiaNivel: NivelCargoSchema.nullable().default(null),
  autonomiaParagrafos: z.array(z.string()).default([]),
  /** true = MENSURÁVEL, false = NÃO MENSURÁVEL, null = não detectado. */
  mensuravel: z.boolean().nullable().default(null),
  /** Mensagens sobre o que não pôde ser extraído. */
  avisos: z.array(z.string()).default([]),
});
export type TemplateVagaParsed = z.infer<typeof TemplateVagaParsedSchema>;

/** Opção de estrutura organizacional (departamento, cargo ou filial) da Gupy. */
export interface OpcaoEstruturaDTO {
  id: number;
  nome: string;
  /** true quando é o melhor match sugerido para o texto do template. */
  sugerido?: boolean;
}

/** Tipos de vaga aceitos pela Gupy (subset usual). */
export const TipoVagaGupySchema = z.enum([
  'effective',
  'internship',
  'apprentice',
  'temporary',
  'associate',
  'talent_pool',
  'outsource',
  'young_apprentice',
]);
export type TipoVagaGupy = z.infer<typeof TipoVagaGupySchema>;

export const WorkplaceTypeSchema = z.enum(['on-site', 'remote', 'hybrid']);
export const PublicationTypeSchema = z.enum(['external', 'internal']);

/**
 * Payload da etapa C (publicar). Junta o conteúdo do template (editável no
 * formulário) com os campos estruturais que só a Gupy conhece.
 */
export const PublicarVagaInputSchema = z.object({
  // ---- Conteúdo (vem do template, editável) ----
  titulo: z.string().min(2).max(200),
  departamentoNome: z.string().nullable().optional(),
  missao: z.string().min(1),
  formacaoMinima: z.string().nullable().optional(),
  formacaoIdeal: z.string().nullable().optional(),
  conhecimentos: z.array(ConhecimentoEspecificoSchema).default([]),
  responsabilidades: z.array(z.string()).default([]),
  autonomiaNivel: NivelCargoSchema.nullable().optional(),
  autonomiaParagrafos: z.array(z.string()).default([]),
  mensuravel: z.boolean().nullable().optional(),

  // ---- Estrutura / exigências da Gupy ----
  departmentId: z.number().int().positive(),
  roleId: z.number().int().positive(),
  branchId: z.number().int().positive().nullable().optional(),
  type: TipoVagaGupySchema.default('effective'),
  numVacancies: z.number().int().min(1).max(999).default(1),
  /** ISO date (YYYY-MM-DD). Exigida para publicar. */
  hiringDeadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  workplaceType: WorkplaceTypeSchema.nullable().optional(),
  publicationType: PublicationTypeSchema.default('external'),
  code: z.string().max(60).nullable().optional(),
  recruiterEmail: z.string().email().nullable().optional(),
  managerEmail: z.string().email().nullable().optional(),

  /** true = cria rascunho e já publica; false = só rascunho na Gupy. */
  publicarAgora: z.boolean().default(false),

  /** sha256 do .xlsx arquivado no storage (auditoria), quando houver. */
  arquivoSha256: z.string().nullable().optional(),
});
export type PublicarVagaInput = z.infer<typeof PublicarVagaInputSchema>;

/** Resposta do endpoint de publicação. */
export interface PublicarVagaResultDTO {
  vagaId: string;
  gupyId: string;
  status: 'RASCUNHO' | 'PUBLICADA';
}
