import type { Area } from '../auth';
import { ARTIGOS_COMECANDO } from './conteudo/comecando';
import { ARTIGOS_CONFIGURACAO } from './conteudo/configuracao';
import { ARTIGOS_ENTENDA } from './conteudo/entenda';
import { ARTIGOS_RECRUTAMENTO } from './conteudo/recrutamento';
import { ARTIGOS_SISTEMA } from './conteudo/sistema';
import type { Artigo, Bloco } from './tipos';

export { SECOES } from './tipos';
export type { Artigo, Bloco, SecaoAjuda, TomNota } from './tipos';

/** Todos os artigos, na ordem em que aparecem no índice. */
export const ARTIGOS: Artigo[] = [
  ...ARTIGOS_COMECANDO,
  ...ARTIGOS_RECRUTAMENTO,
  ...ARTIGOS_CONFIGURACAO,
  ...ARTIGOS_SISTEMA,
  ...ARTIGOS_ENTENDA,
];

export function artigoPorSlug(slug: string): Artigo | undefined {
  return ARTIGOS.find((a) => a.slug === slug);
}

// ---------------------------------------------------------------------------
// Visibilidade — espelha a regra da sidebar
// ---------------------------------------------------------------------------

/**
 * O artigo entra no índice deste usuário? Sem `areas` = todo mundo; 'admin' vê
 * tudo. Vale só para a LISTAGEM: link direto para um artigo sempre abre, porque
 * ajuda é documentação, não dado do processo.
 */
export function artigoVisivel(artigo: Artigo, areas: Area[]): boolean {
  if (!artigo.areas || artigo.areas.length === 0) return true;
  if (areas.includes('admin')) return true;
  return artigo.areas.some((a) => areas.includes(a));
}

export function artigosVisiveis(areas: Area[]): Artigo[] {
  return ARTIGOS.filter((a) => artigoVisivel(a, areas));
}

// ---------------------------------------------------------------------------
// Rota → artigo (botão “?” do cabeçalho)
// ---------------------------------------------------------------------------

/** Casa `/vagas/abc-123/ranking` com um padrão que use asterisco no lugar do id. */
function casaRota(padrao: string, caminho: string): boolean {
  const p = padrao.split('/').filter(Boolean);
  const c = caminho.split('/').filter(Boolean);
  if (p.length !== c.length) return false;
  return p.every((seg, i) => seg === '*' || seg === c[i]);
}

/** Quanto mais segmentos literais, mais específico — desempata `/vagas/publicar` × `/vagas`. */
function especificidade(padrao: string): number {
  return padrao.split('/').filter((s) => s && s !== '*').length;
}

/**
 * Artigo que documenta a tela atual. Devolve o padrão MAIS específico que casa,
 * então uma rota nova sem artigo próprio simplesmente não mostra o botão (em vez
 * de abrir o artigo errado do prefixo pai).
 */
export function artigoDaRota(caminho: string | null): Artigo | undefined {
  if (!caminho) return undefined;
  let melhor: { artigo: Artigo; peso: number } | undefined;
  for (const artigo of ARTIGOS) {
    for (const padrao of artigo.rotas ?? []) {
      if (!casaRota(padrao, caminho)) continue;
      const peso = especificidade(padrao);
      if (!melhor || peso > melhor.peso) melhor = { artigo, peso };
    }
  }
  return melhor?.artigo;
}

// ---------------------------------------------------------------------------
// Busca
// ---------------------------------------------------------------------------

/** Texto corrido de um bloco — alimenta a busca (por isso o conteúdo é dado, não JSX). */
function textoDoBloco(b: Bloco): string {
  switch (b.tipo) {
    case 'titulo':
    case 'p':
    case 'nota':
      return b.texto;
    case 'lista':
    case 'passos':
      return b.itens.join(' ');
    case 'tabela':
      return [...b.colunas, ...b.linhas.flat()].join(' ');
  }
}

function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, ''); // sem acento: "analise" acha "análise"
}

function corpoBuscavel(a: Artigo): string {
  return normalizar(
    [a.titulo, a.resumo, ...a.blocos.map(textoDoBloco)].join(' '),
  );
}

// O corpo normalizado de cada artigo não muda em runtime: calcula uma vez.
const CACHE_BUSCA = new Map<string, string>(
  ARTIGOS.map((a) => [a.slug, corpoBuscavel(a)]),
);

/**
 * Busca simples: todos os termos precisam aparecer em algum lugar do artigo.
 * Ordena por onde o termo bateu — título vale mais que corpo.
 */
export function buscar(termo: string, artigos: Artigo[] = ARTIGOS): Artigo[] {
  const termos = normalizar(termo).split(/\s+/).filter(Boolean);
  if (termos.length === 0) return artigos;

  return artigos
    .map((a) => {
      const corpo = CACHE_BUSCA.get(a.slug) ?? corpoBuscavel(a);
      if (!termos.every((t) => corpo.includes(t))) return null;
      const titulo = normalizar(a.titulo);
      const resumo = normalizar(a.resumo);
      const peso = termos.reduce(
        (acc, t) =>
          acc + (titulo.includes(t) ? 4 : 0) + (resumo.includes(t) ? 2 : 0),
        0,
      );
      return { artigo: a, peso };
    })
    .filter((r): r is { artigo: Artigo; peso: number } => r !== null)
    .sort((x, y) => y.peso - x.peso)
    .map((r) => r.artigo);
}
