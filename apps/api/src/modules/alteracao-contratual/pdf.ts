/**
 * Gerador de PDF MÍNIMO (zero dependências). Suficiente para o documento de
 * alteração contratual enviado ao Autentique (que exige um arquivo no
 * createDocument). Uma fonte (Helvetica, WinAnsi → acentos PT-BR ok), múltiplas
 * páginas, quebra de linha por largura. NÃO é um layout sofisticado — é um PDF
 * válido e legível.
 */

const LARGURA = 595; // A4 em pontos
const ALTURA = 842;
const MARGEM = 50;
const LH = 16; // entrelinha
const FONTE = 11;
const FONTE_TIT = 14;

/** Mapeia para o subconjunto representável em latin1/WinAnsi (acentos PT-BR ok). */
function sanitize(s: string): string {
  return s
    .replace(/[—–]/g, '-')
    .replace(/→/g, '->')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[^\x00-\xFF]/g, '?');
}

function escapar(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/** Quebra um texto em linhas que cabem na largura útil (aproximação Helvetica). */
function wrap(texto: string, fs: number): string[] {
  const maxLargura = LARGURA - MARGEM * 2;
  const max = Math.max(10, Math.floor(maxLargura / (fs * 0.5)));
  const out: string[] = [];
  for (const paragrafo of texto.split('\n')) {
    const palavras = paragrafo.split(/\s+/).filter(Boolean);
    if (palavras.length === 0) {
      out.push('');
      continue;
    }
    let linha = '';
    for (const p of palavras) {
      if (linha && linha.length + 1 + p.length > max) {
        out.push(linha);
        linha = p;
      } else {
        linha = linha ? `${linha} ${p}` : p;
      }
    }
    if (linha) out.push(linha);
  }
  return out;
}

interface Item {
  texto: string;
  fs: number;
}

export function gerarPdfSimples(titulo: string, linhas: string[]): Buffer {
  // Monta a lista de linhas (título + corpo), já com quebra por largura.
  const itens: Item[] = [];
  for (const l of wrap(sanitize(titulo), FONTE_TIT)) itens.push({ texto: l, fs: FONTE_TIT });
  itens.push({ texto: '', fs: FONTE });
  for (const linha of linhas) {
    for (const l of wrap(sanitize(linha), FONTE)) itens.push({ texto: l, fs: FONTE });
  }

  // Paginação simples por número de linhas.
  const porPagina = Math.max(1, Math.floor((ALTURA - MARGEM * 2) / LH));
  const paginas: Item[][] = [];
  for (let i = 0; i < itens.length; i += porPagina) paginas.push(itens.slice(i, i + porPagina));
  if (paginas.length === 0) paginas.push([{ texto: '', fs: FONTE }]);

  // Conteúdo (content stream) de cada página.
  const streams = paginas.map((pagina) => {
    let s = `BT ${LH} TL 1 0 0 1 ${MARGEM} ${ALTURA - MARGEM} Tm\n`;
    let fsAtual = 0;
    pagina.forEach((it, idx) => {
      if (it.fs !== fsAtual) {
        s += `/F1 ${it.fs} Tf\n`;
        fsAtual = it.fs;
      }
      s += `(${escapar(it.texto)}) Tj`;
      s += idx < pagina.length - 1 ? ' T*\n' : '\n';
    });
    s += 'ET';
    return s;
  });

  // Objetos PDF. 1=Catalog, 2=Pages, 3=Font; depois (page, content) por página.
  const objetos: Array<{ num: number; corpo: string }> = [];
  objetos.push({ num: 1, corpo: '<< /Type /Catalog /Pages 2 0 R >>' });
  const kids = paginas.map((_, i) => `${4 + 2 * i} 0 R`).join(' ');
  objetos.push({
    num: 2,
    corpo: `<< /Type /Pages /Kids [${kids}] /Count ${paginas.length} >>`,
  });
  objetos.push({
    num: 3,
    corpo: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  });
  paginas.forEach((_, i) => {
    const pageNum = 4 + 2 * i;
    const contentNum = 5 + 2 * i;
    objetos.push({
      num: pageNum,
      corpo:
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${LARGURA} ${ALTURA}] ` +
        `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentNum} 0 R >>`,
    });
    const stream = streams[i];
    const len = Buffer.byteLength(stream, 'latin1');
    objetos.push({
      num: contentNum,
      corpo: `<< /Length ${len} >>\nstream\n${stream}\nendstream`,
    });
  });

  // Serializa, rastreando offsets (em bytes latin1) para a xref.
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const o of objetos) {
    offsets[o.num] = Buffer.byteLength(pdf, 'latin1');
    pdf += `${o.num} 0 obj\n${o.corpo}\nendobj\n`;
  }
  const xrefStart = Buffer.byteLength(pdf, 'latin1');
  const total = objetos.length + 1; // + objeto livre 0
  pdf += `xref\n0 ${total}\n`;
  pdf += '0000000000 65535 f \n';
  for (let n = 1; n < total; n++) {
    pdf += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return Buffer.from(pdf, 'latin1');
}
