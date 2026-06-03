/**
 * Parser do formulário padrão "Descrição do Cargo" (DHO/Unifique).
 *
 * Os arquivos chegam em duas origens com layouts de célula DIFERENTES:
 *  - Google Sheets  → strings inline;
 *  - Excel          → sharedStrings;
 * e as posições de célula variam. Por isso NÃO usamos coordenadas fixas:
 * localizamos cada seção pelos RÓTULOS (constantes) e pegamos o valor mais
 * próximo. O exceljs resolve inline/sharedStrings/rich-text de forma
 * transparente via `cell.text`.
 *
 * Campos ausentes nunca quebram o parser — viram null/[] e o motivo entra em
 * `avisos`, para o líder corrigir no formulário antes de publicar.
 */
import { inflateRawSync } from 'node:zlib';
import {
  ConhecimentoEspecifico,
  GrauConhecimento,
  NivelCargo,
  TemplateVagaParsed,
} from '@triagem/shared';

interface Celula {
  row: number;
  col: number;
  text: string;
}

/**
 * Leitor de .xlsx SEM dependências externas.
 *
 * Motivo: o exceljs lança ao abrir os arquivos exportados do Google Sheets
 * (drawings/anchors fora do formato que ele espera). Aqui tratamos o .xlsx
 * como ZIP (inflate via zlib nativo) e lemos o XML diretamente, o que cobre
 * tanto a origem Google Sheets (strings inline) quanto Excel (sharedStrings).
 */
function lerEntradasZip(buf: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  const EOCD = 0x06054b50;
  let eocd = -1;
  const min = Math.max(0, buf.length - 22 - 65536);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Não é um arquivo ZIP/.xlsx válido (EOCD).');
  const cdOffset = buf.readUInt32LE(eocd + 16);
  const cdCount = buf.readUInt16LE(eocd + 10);
  let p = cdOffset;
  for (let n = 0; n < cdCount; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const lhNameLen = buf.readUInt16LE(localOff + 26);
    const lhExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lhNameLen + lhExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);
    try {
      entries.set(name, method === 0 ? Buffer.from(raw) : inflateRawSync(raw));
    } catch {
      /* entrada corrompida — ignora */
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function decodeXml(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Concatena todos os <t>…</t> de um trecho XML. */
function textosDe(xml: string): string {
  let out = '';
  const re = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out += decodeXml(m[1]);
  return out;
}

function parseSharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  const out: string[] = [];
  const re = /<si>([\s\S]*?)<\/si>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(textosDe(m[1]));
  return out;
}

function refParaLinhaColuna(ref: string): { row: number; col: number } | null {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!m) return null;
  let col = 0;
  for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { col, row: Number(m[2]) };
}

/** Lê as células com texto de uma worksheet XML. */
function parseWorksheet(xml: string, shared: string[]): Celula[] {
  const cells: Celula[] = [];
  // Casa <c ...>…</c> e também <c .../> (vazias, ignoradas).
  const re = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const attrs = m[1];
    const inner = m[2];
    if (!inner) continue;
    const refMatch = /\br="([A-Z]+\d+)"/.exec(attrs);
    if (!refMatch) continue;
    const pos = refParaLinhaColuna(refMatch[1]);
    if (!pos) continue;
    const tMatch = /\bt="([^"]+)"/.exec(attrs);
    const t = tMatch ? tMatch[1] : 'n';
    let text = '';
    if (t === 's') {
      const v = /<v>(\d+)<\/v>/.exec(inner);
      if (v) text = shared[Number(v[1])] ?? '';
    } else if (t === 'inlineStr') {
      text = textosDe(inner);
    } else if (t === 'str') {
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner);
      if (v) text = decodeXml(v[1]);
    } else {
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner);
      if (v) text = decodeXml(v[1]);
    }
    text = text.replace(/\r/g, '').trim();
    if (text.length > 0) cells.push({ row: pos.row, col: pos.col, text });
  }
  return cells;
}

/** Remove acentos, caixa e espaços redundantes para casar rótulos. */
function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Texto "longo" = conteúdo de fato (missão, formação, competência...). */
function isLongo(text: string): boolean {
  return text.trim().length >= 25;
}

/** Rótulos/legendas que NÃO são valores de conteúdo. */
const ROTULOS = [
  'DESCRICAO DO CARGO',
  'CONHECA SEU CARGO',
  'SUA MISSAO E',
  'PARA ISSO, VOCE PRECISARA TER',
  'PARA ISSO VOCE PRECISARA TER',
  'CONHECIMENTOS ESPECIFICOS',
  'GRAU DE DOMINIO',
  'NIVEL DO CARGO',
  'PRINCIPAIS RESPONSABILIDADES',
  'AUTONOMIA',
  'GRAU DE AUTONOMIA E COMPLEXIDADE',
  'RESPONSABILIDADE POR RESULTADOS',
  'MENSURAVEL',
  'NAO MENSURAVEL',
];

function ehRotulo(text: string): boolean {
  const n = norm(text);
  if (ROTULOS.some((r) => n === r || n.startsWith(r))) return true;
  // legendas curtas (B/I/A, JR/PL/SR, X)
  if (/^[BIAX]$/.test(n)) return true;
  if (/^(JR|PL|SR)$/.test(n)) return true;
  return false;
}

export class TemplateParser {
  /** Lê um .xlsx e devolve o template estruturado. */
  static async parseXlsx(buffer: Buffer): Promise<TemplateVagaParsed> {
    let entries: Map<string, Buffer>;
    try {
      entries = lerEntradasZip(buffer);
    } catch {
      return TemplateParser.vazio([
        'Arquivo inválido: não foi possível ler como planilha .xlsx.',
      ]);
    }

    const decode = (name: string): string | undefined =>
      entries.get(name)?.toString('utf8');

    const shared = parseSharedStrings(decode('xl/sharedStrings.xml'));

    // Primeira worksheet (sheet1.xml por convenção; senão a de menor número).
    const sheetNames = [...entries.keys()]
      .filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k))
      .sort();
    const sheetXml = sheetNames.length ? decode(sheetNames[0]) : undefined;
    if (!sheetXml) {
      return TemplateParser.vazio(['Planilha sem nenhuma aba legível.']);
    }

    const cells = parseWorksheet(sheetXml, shared);
    return TemplateParser.extrair(cells);
  }

  // ---------------------------------------------------------------
  //  Núcleo de extração (compartilhado por xlsx)
  // ---------------------------------------------------------------
  private static extrair(cells: Celula[]): TemplateVagaParsed {
    const avisos: string[] = [];
    const ordenadas = [...cells].sort((a, b) =>
      a.row !== b.row ? a.row - b.row : a.col - b.col,
    );

    const acharRotulo = (...patterns: string[]): Celula | undefined =>
      ordenadas.find((c) => {
        const n = norm(c.text);
        return patterns.some((p) => n === p || n.startsWith(p));
      });

    /** Valor longo mais próximo APÓS uma célula (linha abaixo ou à direita). */
    const valorApos = (label: Celula | undefined): string | null => {
      if (!label) return null;
      const cand = ordenadas.find(
        (c) =>
          (c.row > label.row ||
            (c.row === label.row && c.col > label.col)) &&
          isLongo(c.text) &&
          !ehRotulo(c.text),
      );
      return cand ? cand.text.trim() : null;
    };

    /** Células de conteúdo entre dois rótulos (exclusivo). */
    const regiao = (
      inicio: Celula | undefined,
      fim: Celula | undefined,
    ): Celula[] => {
      if (!inicio) return [];
      const fimRow = fim ? fim.row : Number.MAX_SAFE_INTEGER;
      return ordenadas.filter((c) => c.row > inicio.row && c.row < fimRow);
    };

    // --- Título + departamento ("Você é ... / Faz parte da área: ...") ---
    let titulo: string | null = null;
    let departamentoNome: string | null = null;
    const cargoCell = ordenadas.find((c) => /voc[eê]\s+[eé]/i.test(c.text));
    if (cargoCell) {
      const mTitulo = cargoCell.text.match(/voc[eê]\s+[eé]:?\s*(.+)/i);
      if (mTitulo) titulo = mTitulo[1].split('\n')[0].trim();
      const mArea = cargoCell.text.match(/faz parte da [aá]rea:?\s*(.+)/i);
      if (mArea) departamentoNome = mArea[1].split('\n')[0].trim();
    }
    if (!titulo) avisos.push('Título do cargo não encontrado ("Você é ...").');
    if (!departamentoNome)
      avisos.push('Área/departamento não encontrado ("Faz parte da área...").');

    // --- Missão ---
    const missao = valorApos(acharRotulo('SUA MISSAO E'));
    if (!missao) avisos.push('Missão não encontrada ("SUA MISSÃO É").');

    // --- Formação mínima / ideal (rótulo e valor podem estar na MESMA célula) ---
    const formacaoMinima = TemplateParser.extrairFormacao(
      ordenadas,
      'FORMACAO MINIMA',
    );
    const formacaoIdeal = TemplateParser.extrairFormacao(
      ordenadas,
      'FORMACAO IDEAL',
    );
    if (!formacaoMinima) avisos.push('Formação mínima não encontrada.');

    // --- Conhecimentos específicos ---
    const conhecRotulo = acharRotulo('CONHECIMENTOS ESPECIFICOS');
    const respRotulo = acharRotulo('PRINCIPAIS RESPONSABILIDADES');
    const conhecimentos: ConhecimentoEspecifico[] = regiao(conhecRotulo, respRotulo)
      .filter((c) => isLongo(c.text) && !ehRotulo(c.text))
      .map((c) => ({
        texto: c.text.trim(),
        grau: TemplateParser.detectarGrau(ordenadas, c),
        nivel: TemplateParser.detectarNivelLinha(ordenadas, c),
      }));
    if (conhecimentos.length === 0)
      avisos.push('Nenhum conhecimento específico identificado.');

    // --- Responsabilidades (bloco grande, itens separados por ";") ---
    const respTexto = valorApos(respRotulo);
    const responsabilidades = respTexto
      ? respTexto
          .split(/;|\n/)
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
      : [];
    if (responsabilidades.length === 0)
      avisos.push('Responsabilidades não encontradas.');

    // --- Autonomia ---
    const autoRotulo =
      acharRotulo('GRAU DE AUTONOMIA E COMPLEXIDADE') ?? acharRotulo('AUTONOMIA');
    const respResultRotulo = acharRotulo('RESPONSABILIDADE POR RESULTADOS');
    const autonomiaParagrafos = regiao(autoRotulo, respResultRotulo)
      .filter((c) => isLongo(c.text) && !ehRotulo(c.text))
      .map((c) => c.text.trim());

    // --- Nível (JR/PL/SR): por marcador na região OU pelo título ---
    let autonomiaNivel: NivelCargo | null =
      TemplateParser.detectarNivelRegiao(regiao(autoRotulo, respResultRotulo)) ??
      TemplateParser.detectarNivelPorTitulo(titulo);

    // mensurabilidade: checkbox é gráfico, não detectável de forma confiável.
    const mensuravel: boolean | null = null;

    return {
      titulo,
      departamentoNome,
      missao,
      formacaoMinima,
      formacaoIdeal,
      conhecimentos,
      responsabilidades,
      autonomiaNivel,
      autonomiaParagrafos,
      mensuravel,
      avisos,
    };
  }

  /** Formação pode vir como "FORMAÇÃO MÍNIMA:\n<texto>" na mesma célula. */
  private static extrairFormacao(
    cells: Celula[],
    rotulo: string,
  ): string | null {
    const cell = cells.find((c) => norm(c.text).startsWith(rotulo));
    if (!cell) return null;
    // Formato comum: "FORMAÇÃO MÍNIMA:\n<conteúdo>" na MESMA célula.
    const nl = cell.text.indexOf('\n');
    let resto = nl >= 0 ? cell.text.slice(nl + 1).trim() : '';
    if (!isLongo(resto)) {
      const colon = cell.text.indexOf(':');
      if (colon >= 0) resto = cell.text.slice(colon + 1).trim();
    }
    if (isLongo(resto)) return resto;
    // senão, valor está numa célula separada logo após.
    const idx = cells.indexOf(cell);
    const prox = cells
      .slice(idx + 1)
      .find((c) => isLongo(c.text) && !ehRotulo(c.text));
    return prox ? prox.text.trim() : null;
  }

  /** Detecta grau B/I/A pelo "X" marcado na linha da competência. */
  private static detectarGrau(
    cells: Celula[],
    comp: Celula,
  ): GrauConhecimento | null {
    // Colunas das legendas B/I/A (linha do cabeçalho "Nível do Cargo").
    const legendas = cells.filter((c) => /^[BIA]$/.test(norm(c.text)));
    if (legendas.length === 0) return null;
    const colDe: Record<string, number> = {};
    for (const l of legendas) colDe[norm(l.text)] = l.col;
    // "X" na mesma faixa de linhas da competência.
    const marca = cells.find(
      (c) =>
        norm(c.text) === 'X' &&
        Math.abs(c.row - comp.row) <= 2 &&
        c.col >= comp.col,
    );
    if (!marca) return null;
    // grau cujo "col" da legenda é o mais próximo da marca.
    let melhor: GrauConhecimento | null = null;
    let menorDist = Number.MAX_SAFE_INTEGER;
    for (const g of ['B', 'I', 'A'] as GrauConhecimento[]) {
      if (colDe[g] === undefined) continue;
      const d = Math.abs(colDe[g] - marca.col);
      if (d < menorDist) {
        menorDist = d;
        melhor = g;
      }
    }
    return melhor;
  }

  /** Detecta JR/PL/SR próximo a uma linha (competência). */
  private static detectarNivelLinha(
    cells: Celula[],
    comp: Celula,
  ): NivelCargo | null {
    const c = cells.find(
      (x) => /^(JR|PL|SR)$/.test(norm(x.text)) && Math.abs(x.row - comp.row) <= 2,
    );
    return c ? (norm(c.text) as NivelCargo) : null;
  }

  private static detectarNivelRegiao(regiao: Celula[]): NivelCargo | null {
    for (const c of regiao) {
      const n = norm(c.text);
      if (/^(JR|PL|SR)$/.test(n)) return n as NivelCargo;
      if (n === 'JUNIOR') return 'JR';
      if (n === 'PLENO') return 'PL';
      if (n === 'SENIOR') return 'SR';
    }
    return null;
  }

  private static detectarNivelPorTitulo(titulo: string | null): NivelCargo | null {
    if (!titulo) return null;
    const n = norm(titulo);
    if (/\bJUNIOR\b|\bJR\b/.test(n)) return 'JR';
    if (/\bPLENO\b|\bPL\b/.test(n)) return 'PL';
    if (/\bSENIOR\b|\bSR\b/.test(n)) return 'SR';
    return null;
  }

  private static vazio(avisos: string[]): TemplateVagaParsed {
    return {
      titulo: null,
      departamentoNome: null,
      missao: null,
      formacaoMinima: null,
      formacaoIdeal: null,
      conhecimentos: [],
      responsabilidades: [],
      autonomiaNivel: null,
      autonomiaParagrafos: [],
      mensuravel: null,
      avisos,
    };
  }
}
