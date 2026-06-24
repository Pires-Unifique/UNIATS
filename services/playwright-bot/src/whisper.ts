import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

import type { Logger } from './logger.js';
import type { Segmento } from './teams-meeting.js';

/**
 * Roda o faster-whisper (via transcribe.py) no WAV e devolve segmentos no mesmo
 * formato do bot (`Segmento`). O script imprime JSON `{segments:[{start,end,text}]}`
 * na stdout. Best-effort: devolve [] em qualquer falha (o Graph é a fonte principal).
 */
export async function transcreverComWhisper(
  wavPath: string,
  opts: { script: string; model: string; lang: string },
  logger: Logger,
): Promise<Segmento[]> {
  if (!existsSync(wavPath)) {
    logger.warn({ wavPath }, 'WAV não existe — pulando Whisper.');
    return [];
  }
  return new Promise<Segmento[]>((resolve) => {
    let out = '';
    const proc = spawn(
      'python3',
      [opts.script, '--wav', wavPath, '--model', opts.model, '--lang', opts.lang],
      { stdio: ['ignore', 'pipe', 'inherit'] },
    );
    proc.stdout.on('data', (d) => {
      out += d.toString();
    });
    proc.on('error', (e) => {
      logger.warn({ err: String(e) }, 'python3/whisper não executou.');
      resolve([]);
    });
    proc.on('close', (code) => {
      if (code !== 0) {
        logger.warn(`transcribe.py saiu com código ${code}.`);
        resolve([]);
        return;
      }
      try {
        const parsed = JSON.parse(out) as {
          segments?: Array<{ start: number; end: number; text: string }>;
        };
        const segs: Segmento[] = (parsed.segments ?? [])
          .map((s) => ({
            inicio_ms: Math.round((s.start ?? 0) * 1000),
            falante: 'Desconhecido', // Whisper não diariza; o falante vem do VTT oficial na fusão
            texto: (s.text ?? '').trim(),
          }))
          .filter((s) => s.texto);
        logger.info({ segmentos: segs.length }, 'Whisper concluído.');
        resolve(segs);
      } catch (e) {
        logger.warn({ err: String(e) }, 'Falha ao parsear saída do Whisper.');
        resolve([]);
      }
    });
  });
}

/** Lê o WAV só pra checar se tem conteúdo (evita rodar Whisper em arquivo vazio). */
export function wavTemConteudo(wavPath: string): boolean {
  try {
    return existsSync(wavPath) && readFileSync(wavPath).length > 1024;
  } catch {
    return false;
  }
}
