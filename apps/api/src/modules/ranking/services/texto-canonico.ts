/**
 * Funções puras para montar os "textos canônicos" enviados ao modelo de embedding.
 *
 * Princípio: o que entra no vetor define o que o ranking captura. Excluímos
 * dados pessoais (LGPD: minimização) e nos focamos no que descreve o JOB FIT.
 *
 * Mantemos como funções puras para serem trivialmente testáveis e estáveis —
 * mudanças aqui invalidam todos os embeddings existentes.
 */

import type { CurriculoEstruturado } from '../../claude/curriculo.schema.js';

/** Versão do builder. Bumpar invalida os embeddings persistidos. */
export const TEXTO_CANONICO_VERSAO = 'v1';

export interface VagaCanonicaInput {
  titulo: string;
  descricao?: string | null;
  departamento?: string | null;
  unidade?: string | null;
  cidade?: string | null;
  estado?: string | null;
  remoto?: boolean | null;
  tipo_contrato?: string | null;
  /**
   * `requisitos_json` é flexível: pode vir como objeto {chave: valor}
   * (o que o gestor preencheu nos custom fields da Gupy) OU como array.
   */
  requisitos_json?: unknown;
  requisitos_texto?: string | null;
}

export interface CurriculoCanonicaInput {
  resumo?: string | null;
  estruturado: Pick<
    CurriculoEstruturado,
    | 'experiencias'
    | 'formacoes'
    | 'competencias'
    | 'idiomas'
    | 'certificacoes'
    | 'anos_experiencia'
  >;
}

/**
 * Monta texto canônico de vaga otimizado para semântica de "perfil ideal".
 *
 * Estrutura: cabeçalho factual + descrição + requisitos do gestor (chave→valor) + tags.
 * Os requisitos do gestor entram com MUITO peso (em duplicata) porque é o sinal
 * mais direto do que o líder está procurando — supera ruído da descrição padrão.
 */
export function montarTextoCanonicoVaga(vaga: VagaCanonicaInput): string {
  const partes: string[] = [];

  partes.push(`Vaga: ${vaga.titulo}`);

  if (vaga.departamento) partes.push(`Departamento: ${vaga.departamento}`);
  if (vaga.unidade) partes.push(`Unidade: ${vaga.unidade}`);

  const local: string[] = [];
  if (vaga.cidade) local.push(vaga.cidade);
  if (vaga.estado) local.push(vaga.estado);
  if (vaga.remoto) local.push('remoto');
  if (local.length) partes.push(`Localização: ${local.join(' / ')}`);

  if (vaga.tipo_contrato) partes.push(`Contrato: ${vaga.tipo_contrato}`);

  if (vaga.descricao?.trim()) {
    partes.push(`\nDescrição:\n${vaga.descricao.trim()}`);
  }

  const reqGestor = formatarRequisitosGestor(vaga.requisitos_json);
  if (reqGestor) {
    // Inclui DUAS vezes: uma para o LLM enxergar como contexto, outra como reforço.
    // Para embedding isso aumenta peso semântico do que o líder marcou como crítico.
    partes.push(`\nRequisitos definidos pelo gestor:\n${reqGestor}`);
    partes.push(`\nPalavras-chave de requisitos: ${reqGestor}`);
  }

  if (vaga.requisitos_texto?.trim()) {
    partes.push(`\nRequisitos (texto):\n${vaga.requisitos_texto.trim()}`);
  }

  return partes.join('\n').trim();
}

/**
 * Monta texto canônico de currículo para embedding.
 *
 * Diferente da vaga, aqui privilegiamos COMPETÊNCIAS e EXPERIÊNCIAS por serem
 * os campos densos em sinal. O resumo entra mas com menos peso.
 */
export function montarTextoCanonicoCurriculo(
  cv: CurriculoCanonicaInput,
): string {
  const partes: string[] = [];

  if (cv.resumo?.trim()) partes.push(`Resumo: ${cv.resumo.trim()}`);

  if (cv.estruturado.anos_experiencia != null) {
    partes.push(`Anos de experiência: ${cv.estruturado.anos_experiencia}`);
  }

  if (cv.estruturado.competencias?.length) {
    partes.push(
      `Competências: ${[...new Set(cv.estruturado.competencias)].join(', ')}`,
    );
  }

  if (cv.estruturado.experiencias?.length) {
    const exp = cv.estruturado.experiencias
      .map((e) => {
        const periodo =
          e.inicio || e.fim ? ` (${e.inicio ?? '?'} – ${e.fim ?? '?'})` : '';
        const tecs = e.tecnologias?.length
          ? ` — Tecnologias: ${e.tecnologias.join(', ')}`
          : '';
        const desc = e.descricao ? ` — ${e.descricao}` : '';
        return `${e.cargo} @ ${e.empresa}${periodo}${tecs}${desc}`;
      })
      .join('\n');
    partes.push(`\nExperiências:\n${exp}`);
  }

  if (cv.estruturado.formacoes?.length) {
    const form = cv.estruturado.formacoes
      .map(
        (f) =>
          `${f.curso} — ${f.instituicao}${f.nivel ? ` (${f.nivel})` : ''}`,
      )
      .join('\n');
    partes.push(`\nFormação:\n${form}`);
  }

  if (cv.estruturado.idiomas?.length) {
    partes.push(
      `Idiomas: ${cv.estruturado.idiomas
        .map((i) => `${i.idioma}${i.nivel ? ` (${i.nivel})` : ''}`)
        .join(', ')}`,
    );
  }

  if (cv.estruturado.certificacoes?.length) {
    partes.push(
      `Certificações: ${cv.estruturado.certificacoes
        .map((c) => `${c.nome}${c.ano ? ` (${c.ano})` : ''}`)
        .join(', ')}`,
    );
  }

  return partes.join('\n').trim();
}

/**
 * Converte `requisitos_json` (formato flexível vindo da Gupy) em string legível.
 * Aceita objeto chave→valor OU array de {label, value}.
 */
function formatarRequisitosGestor(raw: unknown): string | null {
  if (!raw) return null;

  if (Array.isArray(raw)) {
    const linhas = raw
      .map((item) => {
        if (item && typeof item === 'object') {
          const o = item as Record<string, unknown>;
          const k = String(o.label ?? o.name ?? o.titulo ?? '').trim();
          const v = String(o.value ?? o.valor ?? o.resposta ?? '').trim();
          if (k && v) return `- ${k}: ${v}`;
          if (v) return `- ${v}`;
        } else if (typeof item === 'string') {
          return `- ${item.trim()}`;
        }
        return '';
      })
      .filter(Boolean);
    return linhas.length ? linhas.join('\n') : null;
  }

  if (typeof raw === 'object') {
    const linhas = Object.entries(raw as Record<string, unknown>)
      .map(([k, v]) => {
        if (v == null || v === '') return '';
        return `- ${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`;
      })
      .filter(Boolean);
    return linhas.length ? linhas.join('\n') : null;
  }

  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  return null;
}
