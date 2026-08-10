import type { Area } from '../auth';

/**
 * Blocos de conteúdo de um artigo de ajuda.
 *
 * O conteúdo é DADO (não JSX) de propósito: assim a busca da tela `/ajuda`
 * consegue varrer o texto inteiro dos artigos, e a formatação sai igual em
 * todos eles. Marcação inline suportada em qualquer `texto`:
 *   **negrito**, `código`, [rótulo](/rota-interna)
 */
export type Bloco =
  | { tipo: 'titulo'; texto: string }
  | { tipo: 'p'; texto: string }
  | { tipo: 'lista'; itens: string[] }
  | { tipo: 'passos'; itens: string[] }
  | { tipo: 'nota'; tom: TomNota; texto: string }
  | { tipo: 'tabela'; colunas: string[]; linhas: string[][] };

/** `atencao` = pegadinha que já mordeu alguém; `lgpd` = obrigação legal. */
export type TomNota = 'info' | 'atencao' | 'lgpd';

export type SecaoAjuda =
  | 'comecando'
  | 'recrutamento'
  | 'configuracao'
  | 'sistema'
  | 'entenda';

export interface Artigo {
  /** Slug da URL: `/ajuda/<slug>`. Estável — vira link compartilhado. */
  slug: string;
  titulo: string;
  /** Uma linha: aparece no índice e nos resultados da busca. */
  resumo: string;
  secao: SecaoAjuda;
  icone: string;
  /**
   * Áreas que enxergam o artigo NO ÍNDICE (mesma regra da sidebar; 'admin' vê
   * tudo). Sem `areas` = todo mundo. O artigo em si nunca é bloqueado: link
   * direto sempre abre — é documentação, não dado.
   */
  areas?: Area[];
  /**
   * Rotas que este artigo documenta — alimenta o botão “?” do cabeçalho.
   * Um asterisco casa com UM segmento, como em `/vagas/[id]/ranking`. Vence o
   * padrão com mais segmentos literais, então `/vagas/publicar` ganha de
   * `/vagas`.
   */
  rotas?: string[];
  blocos: Bloco[];
  /** Slugs de artigos relacionados, exibidos no fim da página. */
  relacionados?: string[];
}

export const SECOES: Array<{
  id: SecaoAjuda;
  titulo: string;
  descricao: string;
}> = [
  {
    id: 'comecando',
    titulo: 'Começando',
    descricao: 'O básico: entrar, se achar na tela e entender o que você enxerga.',
  },
  {
    id: 'recrutamento',
    titulo: 'O dia a dia',
    descricao: 'Do candidato que chega da Gupy até a análise da entrevista.',
  },
  {
    id: 'configuracao',
    titulo: 'Preparar o terreno',
    descricao: 'Cargos, publicação de vaga, mensagens, perguntas e indicadores.',
  },
  {
    id: 'sistema',
    titulo: 'Sistema',
    descricao: 'Operação da plataforma — acessos, WhatsApp e integrações.',
  },
  {
    id: 'entenda',
    titulo: 'Entenda melhor',
    descricao: 'Como a IA pontua, o que a LGPD exige e o que fazer quando trava.',
  },
];
