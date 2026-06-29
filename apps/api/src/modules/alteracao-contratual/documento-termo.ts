import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import mammoth from 'mammoth';

/**
 * Preenchimento do termo oficial DHO-301 (.docx) e render p/ HTML (preview).
 *
 * Os campos do template são CONTENT CONTROLS (`<w:sdt>`) com `<w:tag w:val="alt_X"/>`
 * — âncora estável (funciona mesmo com o texto do placeholder quebrado em vários
 * runs e com data-binding). Preenchemos trocando o texto dentro do `<w:sdtContent>`
 * de cada controle pela TAG correspondente; removemos `showingPlcHdr`/`dataBinding`
 * para o valor aparecer em qualquer renderizador (Word, mammoth, Autentique).
 *
 * A variante (.docx) é escolhida pela combinação cargo×salário.
 */

export interface DadosTermo {
  tipos: string[]; // CARGO | SALARIO | CENTRO_CUSTO | UNIDADE | LIDER
  colaboradorNome?: string | null;
  colaboradorMatricula?: string | null;
  cargoAtual?: string | null;
  cargoNovo?: string | null;
  cargoDescricao?: string | null;
  diretrizComercial?: boolean | null;
  periculosidade?: boolean | null;
  aluguelFrota?: boolean | null;
  centroAtual?: string | null;
  centroNovo?: string | null;
  unidadeAtual?: string | null;
  unidadeNovo?: string | null;
  liderAtual?: string | null;
  liderNovo?: string | null;
  salarioAtual?: string | null;
  salarioNovo?: string | null;
  razoes?: string | null;
  dataAplicacao?: string | null; // YYYY-MM-DD
}

const TEMPLATES = {
  completo: 'DHO-301_V5_Completo.docx',
  semSalario: 'DHO-301_V5_SemSalario.docx',
  semCargo: 'DHO-301_V5_SemCargo.docx',
  semSalarioECargo: 'DHO-301_V5_SemSalarioECargo.docx',
  apenasSalario: 'DHO-301_V5_ApenasSalario.docx',
} as const;

/** Escolhe a variante do termo conforme o que muda. */
export function selecionarVariante(tipos: string[]): string {
  const cargo = tipos.includes('CARGO');
  const salario = tipos.includes('SALARIO');
  const outros =
    tipos.includes('CENTRO_CUSTO') || tipos.includes('UNIDADE') || tipos.includes('LIDER');
  if (cargo && salario) return TEMPLATES.completo;
  if (cargo && !salario) return TEMPLATES.semSalario;
  if (!cargo && salario && outros) return TEMPLATES.semCargo;
  if (!cargo && salario && !outros) return TEMPLATES.apenasSalario;
  return TEMPLATES.semSalarioECargo; // sem cargo e sem salário (CC/unidade/líder)
}

function dataBR(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}
const s = (v?: string | null) => (v ?? '').toString();

/** Mapa tag → valor (checkboxes viram "X"/""; SIM/NÃO marcam o lado certo). */
export function montarValores(d: DadosTermo): Record<string, string> {
  const tem = (t: string) => d.tipos.includes(t);
  return {
    alt_cargo: tem('CARGO') ? 'X' : '',
    alt_centro_custo: tem('CENTRO_CUSTO') ? 'X' : '',
    alt_filial: tem('UNIDADE') ? 'X' : '',
    alt_salarial: tem('SALARIO') ? 'X' : '',
    alt_ColabNome: s(d.colaboradorNome),
    alt_ColabMatricula: s(d.colaboradorMatricula),
    alt_ColabCargo: s(d.cargoAtual),
    alt_ColabCentroCusto: s(d.centroAtual),
    alt_ColabUnidade: s(d.unidadeAtual),
    alt_ColabLider: s(d.liderAtual),
    alt_ColabSalario: s(d.salarioAtual),
    alt_NovoCargo: s(d.cargoNovo),
    alt_CargoDescricao: s(d.cargoDescricao),
    alt_NovoCentroCusto: s(d.centroNovo),
    alt_NovoUnidade: s(d.unidadeNovo),
    alt_NovoLider: s(d.liderNovo),
    alt_NovoSalario: s(d.salarioNovo),
    alt_DiretrizComercialSim: d.diretrizComercial === true ? 'X' : '',
    alt_DiretrizComercialNao: d.diretrizComercial === false ? 'X' : '',
    alt_PericulosidadeNovaSim: d.periculosidade === true ? 'X' : '',
    alt_PericulosidadeNovaNao: d.periculosidade === false ? 'X' : '',
    alt_AluguelFrotaSim: d.aluguelFrota === true ? 'X' : '',
    alt_AluguelFrotaNao: d.aluguelFrota === false ? 'X' : '',
    alt_Razoes: s(d.razoes),
    alt_CompetenciaInicial: dataBR(d.dataAplicacao),
  };
}

function escaparXml(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Coloca `valor` no 1º <w:t> do conteúdo e zera os demais (lida com runs quebrados). */
function substituirTextoRuns(conteudo: string, valor: string): string {
  let primeiro = true;
  const out = conteudo.replace(/<w:t\b[^>]*>[\s\S]*?<\/w:t>/g, () => {
    if (primeiro) {
      primeiro = false;
      return `<w:t xml:space="preserve">${escaparXml(valor)}</w:t>`;
    }
    return '<w:t></w:t>';
  });
  // Se o controle não tinha run de texto, injeta um run mínimo no início.
  if (primeiro && valor) {
    return `<w:r><w:t xml:space="preserve">${escaparXml(valor)}</w:t></w:r>${conteudo}`;
  }
  return out;
}

/** Preenche o document.xml: para cada <w:sdt> com tag mapeada, troca o texto. */
export function preencherDocumentoXml(
  xml: string,
  valores: Record<string, string>,
): string {
  const re =
    /<w:tag w:val="(alt_[^"]+)"\/>([\s\S]*?)(<w:sdtContent\b[^>]*>)([\s\S]*?)(<\/w:sdtContent>)/g;
  return xml.replace(re, (full, tag, meio, abre, conteudo, fecha) => {
    if (!(tag in valores)) return full;
    const meioLimpo = meio
      .replace(/<w:showingPlcHdr\s*\/>/g, '')
      .replace(/<w:dataBinding\b[^>]*\/>/g, '');
    return `<w:tag w:val="${tag}"/>${meioLimpo}${abre}${substituirTextoRuns(conteudo, valores[tag])}${fecha}`;
  });
}

/** Preenche um template .docx (Buffer) e devolve o .docx preenchido. */
export function preencherDocx(template: Uint8Array, valores: Record<string, string>): Buffer {
  const arquivos = unzipSync(template);
  const docXml = arquivos['word/document.xml'];
  if (!docXml) throw new Error('Template inválido: word/document.xml ausente.');
  const novoXml = preencherDocumentoXml(strFromU8(docXml), valores);
  arquivos['word/document.xml'] = strToU8(novoXml);
  return Buffer.from(zipSync(arquivos));
}

/** Caminho absoluto de um template. Em runtime fica em dist/.../templates (nest
 *  assets); rodando o source (tsx), fica em src/.../templates. __dirname cobre os dois. */
export function caminhoTemplate(arquivo: string): string {
  return join(__dirname, 'templates', arquivo);
}

/** Gera o .docx preenchido para os dados do termo. */
export function gerarDocxTermo(dados: DadosTermo): { buffer: Buffer; arquivo: string } {
  const arquivo = selecionarVariante(dados.tipos);
  const template = readFileSync(caminhoTemplate(arquivo));
  const buffer = preencherDocx(template, montarValores(dados));
  return { buffer, arquivo };
}

/** Logo do termo (imagem flutuante que o mammoth ignora) → prependa manualmente. */
function extrairLogo(docx: Buffer): string | null {
  try {
    const arquivos = unzipSync(docx);
    const nome = Object.keys(arquivos).find((n) => /^word\/media\/image1\.(jpe?g|png)$/i.test(n));
    if (!nome) return null;
    const mime = /\.png$/i.test(nome) ? 'image/png' : 'image/jpeg';
    const b64 = Buffer.from(arquivos[nome]).toString('base64');
    return `data:${mime};base64,${b64}`;
  } catch {
    return null;
  }
}

/** Converte um .docx em HTML (preview), com logo + título (vêm do header do Word). */
export async function docxParaHtml(docx: Buffer): Promise<string> {
  const r = await mammoth.convertToHtml(
    { buffer: docx },
    {
      convertImage: mammoth.images.imgElement(async (image) => {
        const b64 = Buffer.from(await image.read()).toString('base64');
        return { src: `data:${image.contentType};base64,${b64}` };
      }),
    },
  );
  const logo = extrairLogo(docx);
  const cabecalho =
    (logo ? `<p style="text-align:center"><img src="${logo}" style="max-height:90px"/></p>` : '') +
    `<h2 style="text-align:center">ALTERAÇÃO CONTRATUAL</h2>`;
  return cabecalho + r.value;
}

/** Atalho: dados → HTML do termo preenchido. */
export async function gerarHtmlTermo(dados: DadosTermo): Promise<string> {
  return docxParaHtml(gerarDocxTermo(dados).buffer);
}
