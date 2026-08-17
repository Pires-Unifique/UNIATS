/**
 * FRONTEIRA DE SAÍDA DO CURRÍCULO PARA IA EXTERNA.
 *
 * Nada do currículo vai para a Voyage ou para o Claude sem passar por aqui.
 *
 * ┌─ POR QUE UMA FUNÇÃO SÓ ──────────────────────────────────────────────────┐
 * │ O furo que originou este código foi exatamente a ausência de um ponto    │
 * │ único: a censura existia (RedacaoService), estava ligada na transcrição, │
 * │ e ninguém percebeu que o currículo saía cru por duas portas diferentes.  │
 * │ Enquanto as fronteiras chamarem esta função, uma porta nova nasce segura.│
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * O que é risco e o que não é:
 *
 *   - `descricao` de cada experiência é TEXTO LIVRE escrito pelo candidato
 *     (`activitiesPerformed` da Gupy). É onde aparece "atuei na pastoral",
 *     "diretor do sindicato", "afastado por tratamento". Art. 11.
 *   - `resumo` tem a mesma natureza (hoje nulo — só o parser de PDF preenche).
 *   - `texto_normalizado` carrega os dois acima concatenados.
 *   - O resto — cargo, empresa, datas, competências, formação, idiomas — é
 *     estruturado e vem de campos fechados da Gupy. Seguro por construção.
 *
 * FAIL-CLOSED SEM QUEBRAR O RANKING: quando o espelho censurado ainda não foi
 * calculado, os campos de risco são OMITIDOS e o resto segue. O ranking perde
 * um pouco de sinal e nada vaza. Travar o ranking inteiro seria pior: alguém
 * desligaria a proteção no primeiro incidente.
 */

/** Bumpar reprocessa todos os espelhos (mesma convenção de `parser_versao`). */
export const REDACAO_CV_VERSAO = 'redacao-cv-v1';

/** Campos que a fronteira lê do banco. Espelho e original lado a lado. */
export interface CurriculoParaIAInput {
  resumo?: string | null;
  experiencias?: unknown;
  formacoes?: unknown;
  competencias?: string[] | null;
  idiomas?: unknown;
  certificacoes?: unknown;
  anos_experiencia?: number | null;
  texto_normalizado?: string | null;

  // Espelho censurado — preenchido pelo job `cv-redacao`.
  ia_resumo?: string | null;
  ia_experiencias?: unknown;
  ia_texto?: string | null;
  ia_redacao_versao?: string | null;
}

export interface CurriculoSeguro {
  resumo: string | null;
  experiencias: unknown[];
  formacoes: unknown;
  competencias: string[];
  idiomas: unknown;
  certificacoes: unknown;
  anos_experiencia: number | null;
  /** Trecho literal para o prompt. Vazio quando não há espelho. */
  textoLiteral: string;
  /** false quando o espelho faltava e os campos de risco foram omitidos. */
  completo: boolean;
}

/** O espelho vale? Versão diferente = prompt mudou, trata como ausente. */
function espelhoValido(cv: CurriculoParaIAInput): boolean {
  return cv.ia_redacao_versao === REDACAO_CV_VERSAO;
}

/**
 * Remove `descricao` das experiências preservando o resto do objeto.
 * Usado quando não há espelho: o histórico (cargo, empresa, período) continua
 * alimentando o ranking; só o texto livre fica de fora.
 */
function semDescricao(experiencias: unknown): unknown[] {
  if (!Array.isArray(experiencias)) return [];
  return experiencias.map((e) => {
    if (!e || typeof e !== 'object') return e;
    const { descricao: _descartada, ...resto } = e as Record<string, unknown>;
    return resto;
  });
}

/**
 * Devolve a versão do currículo que pode atravessar a fronteira.
 *
 * Com espelho válido: usa o texto censurado.
 * Sem espelho: omite `descricao`, `resumo` e o trecho literal.
 */
export function prepararCurriculoParaIA(
  cv: CurriculoParaIAInput,
): CurriculoSeguro {
  const temEspelho = espelhoValido(cv);

  return {
    resumo: temEspelho ? (cv.ia_resumo ?? null) : null,
    experiencias: temEspelho
      ? Array.isArray(cv.ia_experiencias)
        ? (cv.ia_experiencias as unknown[])
        : []
      : semDescricao(cv.experiencias),
    // Campos estruturados seguem intactos nos dois casos — não há texto livre
    // neles, e removê-los só degradaria o ranking sem ganho de privacidade.
    formacoes: cv.formacoes ?? [],
    competencias: cv.competencias ?? [],
    idiomas: cv.idiomas ?? [],
    certificacoes: cv.certificacoes ?? [],
    anos_experiencia: cv.anos_experiencia ?? null,
    textoLiteral: temEspelho ? (cv.ia_texto ?? '') : '',
    completo: temEspelho,
  };
}

/** Colunas que a fronteira precisa ler. Use no `select` do Prisma. */
export const SELECT_CURRICULO_PARA_IA = {
  resumo: true,
  experiencias: true,
  formacoes: true,
  competencias: true,
  idiomas: true,
  certificacoes: true,
  anos_experiencia: true,
  texto_normalizado: true,
  ia_resumo: true,
  ia_experiencias: true,
  ia_texto: true,
  ia_redacao_versao: true,
} as const;
