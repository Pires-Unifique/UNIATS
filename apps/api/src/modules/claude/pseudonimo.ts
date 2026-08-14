/**
 * Pseudonimização do nome do candidato antes de chamar o LLM (REQ-AI-009).
 *
 * A observação que faz isto funcionar sem custo de qualidade: o modelo NÃO
 * precisa do nome verdadeiro para saber quem é quem no transcript — precisa de
 * um rótulo CONSISTENTE. Trocando o nome pelo mesmo token no texto e na
 * instrução, a âncora continua inteira e o provedor deixa de receber o dado.
 *
 * Um token por variante (nome completo, primeiro nome, sobrenome), e não um
 * token só para todos: assim `restaurar` devolve exatamente a palavra que
 * estava lá. Com token único, uma citação que dizia "João" voltaria como
 * "João Silva" — e a evidência literal que o DHO lê deixaria de ser literal.
 *
 * O que esta camada NÃO resolve, e é declarado como exceção justificada na
 * avaliação de segurança: a chamada de CENSURA (`redigirSensivel`) precisa ver
 * o texto cru — é ela que torna o resto seguro. Anonimizar antes seria
 * circular. Lá valem as outras mitigações: falha fecha, o cru nunca é
 * persistido, e o provedor não treina sobre entrada de API.
 */

/** Partículas de nome que não identificam ninguém sozinhas. */
const PARTICULAS = new Set([
  'de',
  'da',
  'do',
  'das',
  'dos',
  'e',
  'del',
  'van',
  'von',
]);

/** Curto demais para ser trocado com segurança — viraria ruído no texto. */
const TAMANHO_MINIMO = 3;

export interface Pseudonimizador {
  /** Troca o nome (e suas partes) por tokens. */
  aplicar(texto: string): string;
  /** Devolve os nomes originais no lugar dos tokens. */
  restaurar(texto: string): string;
  /** Rótulo estável para usar na instrução do prompt. */
  readonly rotulo: string;
  /** false quando não há nome utilizável — tudo vira passa-direto. */
  readonly ativo: boolean;
}

const INERTE: Pseudonimizador = {
  aplicar: (t) => t,
  restaurar: (t) => t,
  rotulo: 'o candidato',
  ativo: false,
};

function escaparRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Fronteira de palavra ciente de acentos. O `\b` do JS considera só
 * [A-Za-z0-9_], então em "João" ele enxerga uma fronteira entre "Jo" e "ã" — e
 * o nome não casaria direito. As lookarounds com \p{L} resolvem.
 */
function regexDaVariante(variante: string): RegExp {
  return new RegExp(
    `(?<![\\p{L}\\p{N}])${escaparRegex(variante)}(?![\\p{L}\\p{N}])`,
    'giu',
  );
}

export function criarPseudonimizador(
  nome?: string | null,
): Pseudonimizador {
  const limpo = (nome ?? '').trim().replace(/\s+/g, ' ');
  if (limpo.length < TAMANHO_MINIMO) return INERTE;

  // Nome completo primeiro: as variantes são aplicadas em ordem, e trocar o
  // todo antes das partes evita gerar "[PESSOA_2] [PESSOA_3]" onde cabia um
  // token só.
  const partes = limpo
    .split(' ')
    .filter((p) => p.length >= TAMANHO_MINIMO && !PARTICULAS.has(p.toLowerCase()));

  const variantes: string[] = [];
  const vistos = new Set<string>();
  for (const v of [limpo, ...partes]) {
    const chave = v.toLowerCase();
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    variantes.push(v);
  }
  if (!variantes.length) return INERTE;

  const rotulo = '[CANDIDATO]';
  const mapa = variantes.map((variante, i) => ({
    variante,
    // O primeiro token é o rótulo usado na instrução — o nome completo.
    token: i === 0 ? rotulo : `[CANDIDATO_${i}]`,
    regex: regexDaVariante(variante),
  }));

  return {
    rotulo,
    ativo: true,
    aplicar(texto: string): string {
      let saida = texto;
      for (const { token, regex } of mapa) {
        // `regex` tem a flag /g e é reusada entre chamadas: `replace` reseta o
        // lastIndex sozinho, mas deixamos explícito para não depender disso.
        regex.lastIndex = 0;
        saida = saida.replace(regex, token);
      }
      return saida;
    },
    restaurar(texto: string): string {
      let saida = texto;
      // Do mais específico para o mais genérico: `[CANDIDATO]` é prefixo de
      // `[CANDIDATO_1]`, então restaurá-lo antes deixaria "João_1" no texto.
      for (const { variante, token } of [...mapa].reverse()) {
        saida = saida.split(token).join(variante);
      }
      return saida;
    },
  };
}
