/**
 * Camada 1 da censura LGPD — determinística, em Node, SEM LLM.
 *
 * Objetivo: garantir que identificadores ESTRUTURADOS (formato previsível) nunca
 * sejam persistidos nem enviados à Anthropic. É o "piso" — roda antes de qualquer
 * escrita no banco e antes da Camada 2 (semântica). Só pega o que tem formato
 * reconhecível; dados sensíveis em linguagem natural (saúde, religião, etc.) são
 * responsabilidade da Camada 2.
 *
 * Convenção do marcador: `[OCULTADO: CATEGORIA]`. É neutro (sempre começa por
 * "OCULTADO:"), fácil de detectar no front e indica ao leitor o que foi censurado.
 */

/** Monta um marcador de censura para uma categoria. */
export function marcador(categoria: string): string {
  return `[OCULTADO: ${categoria}]`;
}

/** Casa qualquer marcador de censura (usado pelo front para realçar). */
export const MARCADOR_REGEX = /\[OCULTADO:[^\]]+\]/g;

/** Extrai as categorias (texto após "OCULTADO:") presentes numa string. */
function extrairCategorias(s: string): string[] {
  const out: string[] = [];
  for (const m of s.matchAll(/\[OCULTADO:\s*([^\]]+)\]/g)) {
    out.push(m[1].trim());
  }
  return out;
}

/**
 * Regras de substituição, aplicadas EM ORDEM (mais específico/longo primeiro,
 * para um padrão não "comer" o começo de outro). Cada `replace` pode referenciar
 * grupos capturados (`$1`) — usado nos padrões ancorados por palavra-chave, onde
 * preservamos a palavra e ocultamos só o número.
 */
const REGRAS: ReadonlyArray<{ re: RegExp; replace: string }> = [
  // E-mail (antes de telefone/CPF: contém "@", inconfundível).
  {
    re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    replace: marcador('E-MAIL'),
  },
  // Cartão de crédito: exatamente 16 dígitos em 4 grupos de 4.
  {
    re: /\b\d{4}[\s.-]?\d{4}[\s.-]?\d{4}[\s.-]?\d{4}\b/g,
    replace: marcador('CARTÃO'),
  },
  // CNPJ formatado (##.###.###/####-##).
  {
    re: /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g,
    replace: marcador('CNPJ'),
  },
  // CPF formatado (###.###.###-##).
  {
    re: /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g,
    replace: marcador('CPF'),
  },
  // CEP formatado (#####-###) — só a forma com hífen, p/ não pegar qualquer
  // sequência de 8 dígitos.
  {
    re: /\b\d{5}-\d{3}\b/g,
    replace: marcador('CEP'),
  },
  // CPF sem formatação, ancorado pela palavra "CPF" (evita clobber de telefones).
  {
    re: /\b(CPF)([^\dA-Za-z]{0,10})(\d{3}\.?\d{3}\.?\d{3}-?\d{2}|\d{11})\b/gi,
    replace: `$1$2${marcador('CPF')}`,
  },
  // Documentos diversos ancorados por palavra-chave (RG, CNH, título, PIS, etc.).
  {
    re: /\b(RG|R\.G\.|identidade|CNH|habilita[çc][ãa]o|t[íi]tulo de eleitor|PIS|PASEP|NIT|passaporte|matr[íi]cula)([^\dA-Za-z]{0,10})(\d[\d.\-/ ]{2,}\d|\d{3,})/gi,
    replace: `$1$2${marcador('DOCUMENTO')}`,
  },
  // Data de nascimento ancorada por palavra-chave (não mexe em datas gerais).
  {
    re: /\b(nascimento|nascid[oa] em|nasci em|data de nascimento|dn)([^\d]{0,12})(\d{1,2}[\/.\- ]\d{1,2}[\/.\- ]\d{2,4}|\d{1,2}\s+de\s+[a-zç]+\s+de\s+\d{4})/gi,
    replace: `$1$2${marcador('DATA DE NASCIMENTO')}`,
  },
  // Telefone ancorado por palavra-chave.
  {
    re: /\b(telefone|celular|whats?app|zap|fone|contato|tel)([^\dA-Za-z]{0,12})(\d[\d\s.-]{6,}\d)/gi,
    replace: `$1$2${marcador('TELEFONE')}`,
  },
  // Telefone com DDD entre parênteses: (47) 99999-9999 / (47) 3333-4444.
  {
    re: /\(\d{2}\)\s?\d{4,5}[\s.-]?\d{4}\b/g,
    replace: marcador('TELEFONE'),
  },
  // Celular (9 dígitos no assinante), DDD opcional, +55 opcional.
  {
    re: /\b(?:\+?55[\s.-]?)?(?:\(?\d{2}\)?[\s.-]?)?9\d{4}[\s.-]?\d{4}\b/g,
    replace: marcador('TELEFONE'),
  },
];

/**
 * Aplica a Camada 1 (regex) a um texto. Retorna o texto censurado e as
 * categorias efetivamente ocultadas (para log SEM expor conteúdo).
 */
export function redigirRegex(texto: string): { texto: string; categorias: string[] } {
  if (!texto) return { texto: texto ?? '', categorias: [] };

  const antes = new Set(extrairCategorias(texto));
  let out = texto;
  for (const { re, replace } of REGRAS) {
    out = out.replace(re, replace);
  }

  const categorias = [...new Set(extrairCategorias(out))].filter((c) => {
    // Só conta como "novo" se não estava no texto de entrada.
    return !antes.has(c) || out.length !== texto.length;
  });
  const houveMudanca = out !== texto;
  return { texto: out, categorias: houveMudanca ? categorias : [] };
}
