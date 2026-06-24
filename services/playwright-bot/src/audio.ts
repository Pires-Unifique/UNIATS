import { spawn, type ChildProcess } from 'node:child_process';

import type { Logger } from './logger.js';

/**
 * Captura o áudio da reunião (o que o Chromium toca) gravando o MONITOR do sink
 * PulseAudio em WAV 16 kHz mono (formato que o Whisper espera). O Chromium toca a
 * reunião no sink default (`MEETBOT_AUDIO_SINK`); aqui gravamos o `<sink>.monitor`.
 */
export function iniciarCaptura(
  wavPath: string,
  sink: string,
  logger: Logger,
): ChildProcess {
  const proc = spawn(
    'ffmpeg',
    [
      '-nostdin',
      '-y',
      '-f',
      'pulse',
      '-i',
      `${sink}.monitor`,
      '-ac',
      '1',
      '-ar',
      '16000',
      wavPath,
    ],
    { stdio: 'ignore' },
  );
  proc.on('error', (e) =>
    logger.warn({ err: String(e) }, 'ffmpeg não iniciou (captura de áudio).'),
  );
  logger.info({ wavPath, sink }, 'Captura de áudio iniciada.');
  return proc;
}

/** Encerra a captura graciosamente (SIGINT finaliza o container WAV) e aguarda. */
export async function pararCaptura(proc: ChildProcess): Promise<void> {
  if (proc.exitCode !== null || proc.killed) return;
  await new Promise<void>((resolve) => {
    const done = (): void => resolve();
    proc.once('close', done);
    proc.kill('SIGINT');
    setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch {
        /* já saiu */
      }
      resolve();
    }, 5_000);
  });
}
