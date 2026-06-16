/**
 * Parser de WebVTT do transcript oficial do Teams.
 *
 * Formato típico do Teams:
 *   WEBVTT
 *
 *   0001-0001
 *   00:00:01.234 --> 00:00:05.678
 *   <v Guilherme Viana>Olá, tudo bem?</v>
 *
 * O nome do falante vem na tag de voz `<v Nome>texto</v>`. Nem todo cue tem
 * identificador; alguns blocos são NOTE/header — ignorados.
 */

export interface VttSegmento {
  inicio_ms?: number;
  fim_ms?: number;
  falante?: string;
  texto: string;
}

export interface VttResultado {
  texto: string;
  segmentos: VttSegmento[];
}

/** "HH:MM:SS.mmm" | "MM:SS.mmm" → milissegundos. */
function timestampParaMs(ts: string): number | undefined {
  const m = ts.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?$/);
  if (!m) return undefined;
  const horas = m[1] ? Number(m[1]) : 0;
  const min = Number(m[2]);
  const seg = Number(m[3]);
  const ms = m[4] ? Number(m[4].padEnd(3, '0')) : 0;
  return ((horas * 60 + min) * 60 + seg) * 1000 + ms;
}

export function parseVtt(vtt: string): VttResultado {
  const segmentos: VttSegmento[] = [];
  const blocos = vtt.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split(/\n\s*\n+/);

  for (const bloco of blocos) {
    const linhas = bloco
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    const cueIdx = linhas.findIndex((l) => l.includes('-->'));
    if (cueIdx === -1) continue; // header WEBVTT, NOTE, etc.

    const [iniRaw, fimRaw] = linhas[cueIdx]
      .split('-->')
      .map((s) => s.trim().split(/\s+/)[0]);

    const linhasTexto = linhas.slice(cueIdx + 1);
    if (linhasTexto.length === 0) continue;

    let falante: string | undefined;
    const texto = linhasTexto
      .map((l) => {
        const m = l.match(/^<v\s+([^>]+?)>(.*)$/i);
        if (m) {
          falante = m[1].trim();
          return m[2];
        }
        return l;
      })
      .join(' ')
      // remove tags restantes (</v>, <c>, etc.)
      .replace(/<\/?[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!texto) continue;
    segmentos.push({
      inicio_ms: timestampParaMs(iniRaw),
      fim_ms: timestampParaMs(fimRaw),
      falante,
      texto,
    });
  }

  const texto = segmentos
    .map((s) => (s.falante ? `${s.falante}: ${s.texto}` : s.texto))
    .join('\n')
    .trim();

  return { texto, segmentos };
}
