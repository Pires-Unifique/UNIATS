/**
 * Mapeia payloads da Gupy para entidades do nosso domínio (Prisma).
 * Mantemos puro (sem side-effects) para facilitar teste.
 */
import { Prisma, StatusVaga, StatusCandidatura } from '@collab/db';
import {
  CandidaturaGupy,
  VagaGupy,
  CandidatoGupy,
} from '@collab/shared';

const STATUS_VAGA: Record<string, StatusVaga> = {
  draft: 'RASCUNHO',
  // Aguardando aprovação interna na Gupy — status próprio, filtrável na tela.
  waiting_approval: 'EM_APROVACAO',
  approved: 'APROVADA',
  published: 'PUBLICADA',
  paused: 'PAUSADA',
  frozen: 'PAUSADA', // termo da API real da Gupy para vaga congelada/pausada
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
  // Sem status no payload: forma antiga da API/webhook, que só tratava vaga
  // publicada — mantemos o default histórico.
  if (!s) return 'PUBLICADA';
  // Status DESCONHECIDO vira RASCUNHO (fica fora da visão padrão de publicadas),
  // não PUBLICADA — o sync agora varre todos os status, então valor novo da Gupy
  // não deve poluir a lista de vagas ativas.
  return STATUS_VAGA[s.toLowerCase()] ?? 'RASCUNHO';
}

export function mapearStatusCandidatura(s?: string | null): StatusCandidatura {
  if (!s) return 'EM_ANALISE';
  return STATUS_CANDIDATURA[s.toLowerCase()] ?? 'EM_ANALISE';
}

/**
 * Rótulos PT-BR para o tipo de vaga/contrato. Cobre tanto o enum da API da Gupy
 * (`vacancy_type_effective`) quanto as formas curtas usadas ao criar vaga pelo
 * nosso app (`effective`). Valor desconhecido volta cru (melhor que sumir).
 */
const TIPO_CONTRATO_LABEL: Record<string, string> = {
  effective: 'Efetivo',
  internship: 'Estágio',
  apprentice: 'Aprendiz',
  young_apprentice: 'Jovem Aprendiz',
  trainee: 'Trainee',
  temporary: 'Temporário',
  freelancer: 'Freelancer',
  associate: 'Associado',
  outsource: 'Terceirizado',
  talent_pool: 'Banco de talentos',
  volunteer: 'Voluntário',
  partner: 'Parceiro',
  summer: 'Temporada de Verão',
  intermittent: 'Intermitente',
  legal_entity: 'Pessoa Jurídica (PJ)',
};

export function traduzirTipoContrato(tipo?: string | null): string | null {
  if (!tipo) return null;
  const chave = tipo
    .toLowerCase()
    .replace(/^vacancy_type_/, '')
    .replace(/^vacancy_/, '');
  return TIPO_CONTRATO_LABEL[chave] ?? tipo;
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

/**
 * Vocabulário de formação da Gupy → enum do nosso schema. A Gupy usa o mesmo
 * conjunto em `academicQualification.formation` e em `candidate.schooling`.
 */
function nivelFormacao(valor: unknown): string | null {
  const v = typeof valor === 'string' ? valor.trim().toLowerCase() : '';
  const mapa: Record<string, string> = {
    graduation: 'graduacao',
    technical_course: 'tecnico',
    technological: 'tecnologo',
    post_graduate: 'pos-graduacao',
    mba: 'mba',
    master_degree: 'mestrado',
    phd: 'doutorado',
    high_school: 'outro',
    elementary_school: 'outro',
  };
  return mapa[v] ?? (v ? 'outro' : null);
}

/** `complete|in_progress|incomplete` → rótulo legível (vai para o vetor). */
function statusFormacao(valor: unknown): string | null {
  const v = typeof valor === 'string' ? valor.trim().toLowerCase() : '';
  const mapa: Record<string, string> = {
    complete: 'concluída',
    in_progress: 'em andamento',
    incomplete: 'incompleta',
  };
  return mapa[v] ?? null;
}

/** (ano, mês) → "YYYY-MM" ou "YYYY"; sem ano, null. */
function periodoAcademico(
  ano?: number | null,
  mes?: number | null,
): string | null {
  if (ano == null) return null;
  if (mes == null) return String(ano);
  return `${ano}-${String(mes).padStart(2, '0')}`;
}

/** Normaliza e-mail vindo da Gupy (lower/trim); vazio → null. */
function normalizarEmail(valor: unknown): string | null {
  const e = typeof valor === 'string' ? valor.trim().toLowerCase() : '';
  return e || null;
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
    cidade: vaga.city ?? vaga.addressCity ?? null,
    estado: vaga.state ?? vaga.addressStateShortName ?? vaga.addressState ?? null,
    tipo_contrato: vaga.type ?? null,
    remoto: vaga.isRemoteWork ?? vaga.remoteWorking ?? false,
    status: mapearStatusVaga(vaga.status),
    data_publicacao: vaga.publishedDate
      ? new Date(vaga.publishedDate)
      : vaga.publishedAt
        ? new Date(vaga.publishedAt)
        : null,
    data_fechamento: vaga.closingDate ? new Date(vaga.closingDate) : null,
    // Espelho dos e-mails p/ auto-vínculo (NÃO é a FK gestor_id/recrutador_id).
    gestor_email: normalizarEmail(vaga.managerEmail),
    recrutador_email: normalizarEmail(vaga.recruiterEmail),
    requisitos_json: requisitosJson,
    requisitos_texto: requisitosTexto,
    // Vaga é dado de negócio, não cadastro de candidato — o payload fica, e a
    // tela ainda lê managerName/recruiterName dele (não há coluna para o NOME).
    // O schema já é allowlist, então só campos declarados chegam aqui.
    gupy_payload: vaga as unknown as Prisma.JsonObject,
    gupy_sincronizado_em: new Date(),
  };

  return {
    where: { gupy_id: vaga.id },
    create: base,
    update: {
      ...base,
      // base já reatualiza gestor_email/recrutador_email (espelho da Gupy).
      // NÃO sobrescreve as associações INTERNAS gestor_id/recrutador_id (FKs),
      // que não estão em `base` — o vínculo é feito pela camada de auth.
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
    // Payload bruto NÃO é mais guardado: as colunas acima já são o essencial e
    // nenhum código lia esta coluna (era só "por precaução" — exatamente o que
    // a minimização do art. 6º III proíbe). Gravar DbNull em vez de omitir faz
    // com que cada re-sync LIMPE o payload legado das linhas antigas.
    gupy_payload: Prisma.DbNull,
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
    // Mesma razão de paraUpsertCandidato: o payload da candidatura carrega o
    // cadastro inteiro do candidato aninhado em `candidate`, ninguém o lê, e
    // re-sync com DbNull limpa o que já estava gravado.
    gupy_payload: Prisma.DbNull,
  };
  return {
    where: { gupy_id: cand.id },
    create: base,
    update: {
      ...base,
      // A reprovação feita AQUI grava o motivo em motivo_desclassif, mas a Gupy
      // nem sempre devolve disqualifiedReason no sync — `undefined` preserva o
      // valor local em vez de apagá-lo a cada re-sincronização.
      motivo_desclassif: cand.disqualifiedReason ?? undefined,
    },
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

  // FORMAÇÃO: prioriza `academicQualification` (curso + instituição + tipo +
  // período), presente em ~66% dos candidatos. O caminho antigo usava só
  // `schooling` e produzia `{nivel}` sem curso/instituição — o que fazia o texto
  // canônico virar "undefined — undefined" e apagar a formação do vetor.
  // `schooling` fica como fallback de quem não tem a formação detalhada.
  const formacoesDetalhadas = (c.academicQualification ?? [])
    .map((f) => {
      const curso = f.course?.trim() || null;
      const instituicao = f.institution?.trim() || null;
      if (!curso && !instituicao) return null;
      return {
        curso,
        instituicao,
        nivel: nivelFormacao(f.formation),
        status: statusFormacao(f.status),
        inicio: periodoAcademico(f.startYear, f.startMonth),
        fim: periodoAcademico(f.endYear, f.endMonth),
      };
    })
    .filter((f): f is NonNullable<typeof f> => f !== null);

  const formacoes = formacoesDetalhadas.length
    ? formacoesDetalhadas
    : c.schooling
      ? [
          {
            curso: null,
            instituicao: null,
            nivel: nivelFormacao(String(c.schooling)),
            status: statusFormacao(c.schoolingStatus),
            inicio: null,
            fim: null,
          },
        ]
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
    for (const f of formacoes) {
      const cabeca = [f.curso, f.instituicao].filter(Boolean).join(' — ');
      const detalhes = [f.nivel, f.status].filter(Boolean).join(', ');
      const linha = cabeca && detalhes ? `${cabeca} (${detalhes})` : cabeca || detalhes;
      if (linha) linhas.push(`- ${linha}`);
    }
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
    // v2: formação passou a vir de `academicQualification` (curso + instituição).
    // Bumpar o rótulo deixa rastro de quais linhas já foram reconstruídas — o
    // re-sync reescreve todas, e o guard por conteúdo do EmbeddingService
    // re-embeda só quem realmente mudou de texto.
    parser_versao: 'gupy-structured-v2',
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
