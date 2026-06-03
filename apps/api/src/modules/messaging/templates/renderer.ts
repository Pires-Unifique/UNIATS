import { BadRequestException } from '@nestjs/common';

import type {
  CanalSuportado,
  TemplateResolvido,
  Variaveis,
} from './template.types.js';

export interface MensagemRenderizada {
  templateCodigo: string; // ex.: "convite_triagem@v1"
  canal: CanalSuportado;
  assunto?: string;
  texto: string;
  html?: string;
}

export const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;
const MAX_VAR_LENGTH = 2000;

/**
 * Extrai os nomes de variáveis ({{nome}}) presentes nos corpos informados.
 * Fonte única da sintaxe de placeholder — usada tanto na validação quanto na
 * UI (para mostrar quais variáveis o template exige) sem o recrutador declará-las.
 */
export function extrairVariaveis(
  ...corpos: Array<string | null | undefined>
): string[] {
  const encontradas = new Set<string>();
  for (const corpo of corpos) {
    if (!corpo) continue;
    for (const m of corpo.matchAll(PLACEHOLDER_RE)) {
      encontradas.add(m[1]);
    }
  }
  return [...encontradas];
}

/**
 * Renderiza um template JÁ RESOLVIDO (vindo do banco). **NUNCA usa eval/Function**
 * — só substituição de string. Variáveis são validadas: tamanho limitado,
 * caracteres de controle rejeitados. Para HTML, escapa as variáveis; para texto
 * plano e WhatsApp, mantém literal.
 */
export function renderizarTemplateResolvido(args: {
  template: TemplateResolvido;
  canal: CanalSuportado;
  variaveis: Variaveis;
}): MensagemRenderizada {
  const { template: tmpl, canal, variaveis } = args;

  if (canal === 'WHATSAPP') {
    if (!tmpl.whatsapp) {
      throw new BadRequestException(
        `Template "${tmpl.codigo}@${tmpl.versao}" não tem variante WHATSAPP.`,
      );
    }
    validarVariaveis(tmpl, canal, variaveis, [tmpl.whatsapp.corpo]);
    return {
      templateCodigo: `${tmpl.codigo}@${tmpl.versao}`,
      canal: 'WHATSAPP',
      texto: substituir(tmpl.whatsapp.corpo, variaveis, 'text'),
    };
  }

  // EMAIL
  if (!tmpl.email) {
    throw new BadRequestException(
      `Template "${tmpl.codigo}@${tmpl.versao}" não tem variante EMAIL.`,
    );
  }
  validarVariaveis(tmpl, canal, variaveis, [
    tmpl.email.assunto,
    tmpl.email.texto,
    tmpl.email.html,
  ]);
  const texto = substituir(tmpl.email.texto, variaveis, 'text');
  const html =
    tmpl.email.html != null
      ? substituir(tmpl.email.html, variaveis, 'html')
      : textoPlanoParaHtml(texto);

  return {
    templateCodigo: `${tmpl.codigo}@${tmpl.versao}`,
    canal: 'EMAIL',
    assunto: substituir(tmpl.email.assunto, variaveis, 'text'),
    texto,
    html,
  };
}

/**
 * Valida que todas as variáveis exigidas pelo canal (derivadas dos corpos) estão
 * presentes, e que os valores são seguros (tamanho + sem caracteres de controle).
 */
function validarVariaveis(
  tmpl: TemplateResolvido,
  canal: CanalSuportado,
  variaveis: Variaveis,
  corpos: Array<string | undefined>,
): void {
  const exigidas = extrairVariaveis(...corpos);
  const faltando = exigidas.filter(
    (k) => variaveis[k] == null || String(variaveis[k]).trim() === '',
  );
  if (faltando.length) {
    throw new BadRequestException(
      `Variáveis obrigatórias ausentes em "${tmpl.codigo}@${tmpl.versao}" (${canal}): ${faltando.join(', ')}`,
    );
  }
  for (const [k, v] of Object.entries(variaveis)) {
    const s = String(v);
    if (s.length > MAX_VAR_LENGTH) {
      throw new BadRequestException(
        `Variável "${k}" excede ${MAX_VAR_LENGTH} chars.`,
      );
    }
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(s)) {
      throw new BadRequestException(
        `Variável "${k}" contém caracteres de controle.`,
      );
    }
  }
}

function substituir(
  template: string,
  variaveis: Variaveis,
  modo: 'text' | 'html',
): string {
  return template.replace(PLACEHOLDER_RE, (full, nome) => {
    const v = variaveis[nome];
    if (v == null) {
      // Placeholder não preenchido — mantém literal para detectar bug rápido em logs.
      return full;
    }
    const s = String(v);
    return modo === 'html' ? escaparHtml(s) : s;
  });
}

function escaparHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Fallback simples para gerar HTML a partir do texto plano. */
function textoPlanoParaHtml(texto: string): string {
  const corpo = escaparHtml(texto)
    .split('\n\n')
    .map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('');
  return `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,sans-serif;color:#222">${corpo}</body></html>`;
}
