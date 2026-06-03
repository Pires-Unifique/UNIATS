/**
 * Mapeia payloads da Gupy para entidades do nosso domínio (Prisma).
 * Mantemos puro (sem side-effects) para facilitar teste.
 */
import { Prisma, StatusVaga, StatusCandidatura } from '@triagem/db';
import {
  CandidaturaGupy,
  VagaGupy,
  CandidatoGupy,
} from '@triagem/shared';

const STATUS_VAGA: Record<string, StatusVaga> = {
  draft: 'RASCUNHO',
  published: 'PUBLICADA',
  paused: 'PAUSADA',
  closed: 'ENCERRADA',
  canceled: 'CANCELADA',
};

const STATUS_CANDIDATURA: Record<string, StatusCandidatura> = {
  // valores antigos/fictícios
  in_analysis: 'EM_ANALISE',
  approved: 'APROVADO',
  rejected: 'REPROVADO',
  hired: 'CONTRATADO',
  withdrew: 'DESISTENTE',
  // valores reais da API da Gupy (/jobs/:id/applications)
  in_process: 'EM_ANALISE',
  give_up: 'DESISTENTE',
  reproved: 'REPROVADO',
};

export function mapearStatusVaga(s?: string | null): StatusVaga {
  if (!s) return 'PUBLICADA';
  return STATUS_VAGA[s.toLowerCase()] ?? 'PUBLICADA';
}

export function mapearStatusCandidatura(s?: string | null): StatusCandidatura {
  if (!s) return 'EM_ANALISE';
  return STATUS_CANDIDATURA[s.toLowerCase()] ?? 'EM_ANALISE';
}

/**
 * Remove tags HTML e normaliza espaços/entidades — os campos de texto da Gupy
 * (description, prerequisites, responsibilities) vêm em HTML.
 */
export function limparHtml(html?: string | null): string {
  if (!html) return '';
  return html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/**
 * Consolida o que o gestor/DHO preencheu na vaga (prerequisites, responsibilities,
 * additionalInformation) + customFields, em JSON estruturado e texto plano.
 * O `texto` é o insumo principal para embedding/ranking (Camada 3).
 */
export function extrairRequisitos(
  vaga: VagaGupy,
): { json: Prisma.JsonObject; texto: string } {
  const json: Prisma.JsonObject = {};
  const linhas: string[] = [];

  const prerequisites = limparHtml(vaga.prerequisites);
  const responsibilities = limparHtml(vaga.responsibilities);
  const additional = limparHtml(vaga.additionalInformation);

  if (prerequisites) {
    json.prerequisites = prerequisites;
    linhas.push(`Requisitos e qualificações:\n${prerequisites}`);
  }
  if (responsibilities) {
    json.responsibilities = responsibilities;
    linhas.push(`Atividades e responsabilidades:\n${responsibilities}`);
  }
  if (additional) {
    json.additionalInformation = additional;
    linhas.push(`Informações adicionais:\n${additional}`);
  }
  if (vaga.jobRatingCriterias && vaga.jobRatingCriterias.length > 0) {
    json.jobRatingCriterias = vaga.jobRatingCriterias as any;
  }

  // Campos customizados (estrutura genérica do cliente Gupy). Com fields=all o
  // value pode ser escalar, array ou objeto — normalizamos para texto legível.
  const customFields: Prisma.JsonObject = {};
  for (const cf of vaga.customFields ?? []) {
    const titulo = (cf.title ?? '').trim();
    if (!titulo) continue;
    // No JSON preservamos o valor cru (null permanece null); apenas normalizamos
    // `undefined` para null. A versão legível para o texto usa string vazia.
    customFields[titulo] = (cf.value === undefined ? null : cf.value) as any;
    const valor = cf.value ?? '';
    const legivel = Array.isArray(valor)
      ? valor.filter((v) => v != null && v !== '').join(', ')
      : valor !== null && typeof valor === 'object'
        ? JSON.stringify(valor)
        : String(valor);
    if (legivel && legivel !== '{}' && legivel !== '[]') {
      linhas.push(`${titulo}: ${legivel}`);
    }
  }
  if (Object.keys(customFields).length > 0) json.customFields = customFields;

  return { json, texto: linhas.join('\n\n') };
}

export function paraUpsertVaga(vaga: VagaGupy): Prisma.VagaUpsertArgs {
  const { json: requisitosJson, texto: requisitosTexto } = extrairRequisitos(vaga);
  const base: Prisma.VagaUncheckedCreateInput = {
    gupy_id: vaga.id,
    codigo: vaga.code ?? null,
    titulo: vaga.name,
    descricao: limparHtml(vaga.description) || null,
    departamento: vaga.departmentName ?? vaga.department?.name ?? null,
    unidade: vaga.branchName ?? vaga.branch?.name ?? null,
    cidade: vaga.city ?? null,
    estado: vaga.state ?? null,
    tipo_contrato: vaga.type ?? null,
    remoto: vaga.isRemoteWork ?? vaga.remoteWorking ?? false,
    status: mapearStatusVaga(vaga.status),
    data_publicacao: vaga.publishedDate
      ? new Date(vaga.publishedDate)
      : vaga.publishedAt
        ? new Date(vaga.publishedAt)
        : null,
    data_fechamento: vaga.closingDate ? new Date(vaga.closingDate) : null,
    requisitos_json: requisitosJson,
    requisitos_texto: requisitosTexto,
    gupy_payload: vaga as unknown as Prisma.JsonObject,
    gupy_sincronizado_em: new Date(),
  };

  return {
    where: { gupy_id: vaga.id },
    create: base,
    update: {
      ...base,
      // Não sobrescreve associações internas (recrutador/gestor)
      gupy_sincronizado_em: new Date(),
    },
  };
}

export function paraUpsertCandidato(c: CandidatoGupy): Prisma.CandidatoUpsertArgs {
  const nomeCompleto =
    [c.name, c.lastName].filter((p) => p && p.trim()).join(' ').trim() ||
    c.name;
  const base: Prisma.CandidatoUncheckedCreateInput = {
    gupy_id: c.id,
    nome_completo: nomeCompleto,
    email: c.email ?? null,
    telefone: c.mobileNumber ?? c.phoneNumber ?? c.phone ?? null,
    linkedin_url: c.linkedinProfileUrl ?? c.linkedinUrl ?? null,
    cidade: c.addressCity ?? c.city ?? null,
    estado: c.addressStateShortName ?? c.addressState ?? c.state ?? null,
    gupy_payload: c as unknown as Prisma.JsonObject,
  };
  return {
    where: { gupy_id: c.id },
    create: base,
    update: base,
  };
}

export function paraUpsertCandidatura(
  cand: CandidaturaGupy,
  vagaId: string,
  candidatoId: string,
): Prisma.CandidaturaUpsertArgs {
  const base: Prisma.CandidaturaUncheckedCreateInput = {
    gupy_id: cand.id,
    vaga_id: vagaId,
    candidato_id: candidatoId,
    etapa_gupy: cand.currentStep?.name ?? null,
    status: mapearStatusCandidatura(cand.status ?? cand.currentStep?.status),
    motivo_desclassif: cand.disqualifiedReason ?? null,
    inscrito_em: cand.appliedAt
      ? new Date(cand.appliedAt)
      : cand.createdAt
        ? new Date(cand.createdAt)
        : null,
    movido_em: cand.movedAt ? new Date(cand.movedAt) : null,
    gupy_payload: cand as unknown as Prisma.JsonObject,
  };
  return {
    where: { gupy_id: cand.id },
    create: base,
    update: base,
  };
}

/**
 * Monta o currículo estruturado a partir do perfil que a Gupy entrega com
 * fields=all (workExperience, schooling, languages). Substitui o parse de PDF
 * quando a Gupy já fornece os dados estruturados.
 *
 * Retorna `null` se o candidato não tiver nenhum dado de perfil — nesse caso
 * não criamos um currículo vazio.
 */
export function paraUpsertCurriculoGupy(
  cand: CandidaturaGupy,
  candidaturaId: string,
  candidatoId: string,
): Prisma.CurriculoProcessadoUpsertArgs | null {
  const c = cand.candidate;

  const experiencias = (c.workExperience ?? []).map((w) => {
    const inicio =
      w.startYear != null
        ? `${w.startYear}-${String(w.startMonth ?? 1).padStart(2, '0')}`
        : null;
    const fim =
      w.endYear != null
        ? `${w.endYear}-${String(w.endMonth ?? 1).padStart(2, '0')}`
        : 'atual';
    return {
      empresa: w.companyName ?? null,
      cargo: w.role ?? null,
      inicio,
      fim,
      descricao: w.activitiesPerformed ?? null,
    };
  });

  const idiomas = (c.languages ?? []).map((l) => ({
    idioma: l.language ?? null,
    nivel: l.level ?? null,
  }));

  const formacoes = c.schooling
    ? [{ nivel: String(c.schooling), status: c.schoolingStatus ?? null }]
    : [];

  const competencias = Array.isArray(c.areasOfInterest)
    ? c.areasOfInterest.filter((x): x is string => typeof x === 'string')
    : [];

  // Anos de experiência (soma aproximada dos períodos com ano de início e fim).
  let anos = 0;
  for (const w of c.workExperience ?? []) {
    if (w.startYear != null) {
      const ini = w.startYear + (w.startMonth ?? 1) / 12;
      const fimAno = (w.endYear ?? w.startYear) + (w.endMonth ?? 12) / 12;
      if (fimAno > ini) anos += fimAno - ini;
    }
  }
  const anosExperiencia = anos > 0 ? Math.round(anos * 10) / 10 : null;

  // Texto consolidado — insumo para embedding/ranking (Camada 3).
  const linhas: string[] = [];
  if (experiencias.length) {
    linhas.push('EXPERIÊNCIAS PROFISSIONAIS:');
    for (const e of experiencias) {
      linhas.push(
        `- ${e.cargo ?? ''} @ ${e.empresa ?? ''} (${e.inicio ?? '?'} a ${e.fim})`.trim(),
      );
      if (e.descricao) linhas.push(`  ${e.descricao.replace(/\s+/g, ' ').trim()}`);
    }
  }
  if (formacoes.length) {
    linhas.push('FORMAÇÃO:');
    for (const f of formacoes) linhas.push(`- ${f.nivel} (${f.status ?? '-'})`);
  }
  if (idiomas.length) {
    linhas.push('IDIOMAS:');
    for (const i of idiomas) linhas.push(`- ${i.idioma}: ${i.nivel}`);
  }
  if (competencias.length) {
    linhas.push(`ÁREAS DE INTERESSE: ${competencias.join(', ')}`);
  }

  const texto = linhas.join('\n').trim();
  if (!texto) return null;

  const base: Prisma.CurriculoProcessadoUncheckedCreateInput = {
    candidatura_id: candidaturaId,
    candidato_id: candidatoId,
    arquivo_url: null,
    texto_bruto: texto,
    texto_normalizado: texto,
    experiencias: experiencias as unknown as Prisma.JsonArray,
    formacoes: formacoes as unknown as Prisma.JsonArray,
    competencias,
    idiomas: idiomas as unknown as Prisma.JsonArray,
    anos_experiencia: anosExperiencia,
    parser_versao: 'gupy-structured-v1',
  };

  return {
    where: { candidatura_id: candidaturaId },
    create: base,
    update: {
      ...base,
      atualizado_em: new Date(),
    },
  };
}
