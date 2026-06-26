import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';

import type { Logger } from './logger.js';

const execFileP = promisify(execFile);

/**
 * Cria um sink PulseAudio DEDICADO (null-sink) para esta reunião e devolve o
 * índice do módulo (p/ remover depois). Cada call usa o próprio sink + roteia o
 * seu Chromium via `PULSE_SINK` — assim duas reuniões simultâneas NÃO misturam o
 * áudio no mesmo monitor. Best-effort: null em falha (segue sem áudio isolado).
 */
export async function criarSink(sink: string, logger: Logger): Promise<number | null> {
  try {
    const { stdout } = await execFileP('pactl', [
      'load-module',
      'module-null-sink',
      `sink_name=${sink}`,
      `sink_properties=device.description=${sink}`,
    ]);
    const idx = Number.parseInt(stdout.trim(), 10);
    logger.info({ sink, modulo: idx }, 'Sink de áudio dedicado criado.');
    return Number.isNaN(idx) ? null : idx;
  } catch (e) {
    logger.warn({ sink, err: String(e) }, 'Falha ao criar sink dedicado.');
    return null;
  }
}

/** Remove o sink dedicado (pelo índice do módulo). Best-effort. */
export async function removerSink(
  moduloIdx: number | null,
  logger: Logger,
): Promise<void> {
  if (moduloIdx == null) return;
  try {
    await execFileP('pactl', ['unload-module', String(moduloIdx)]);
  } catch (e) {
    logger.warn({ moduloIdx, err: String(e) }, 'Falha ao remover sink dedicado.');
  }
}

/**
 * Captura o áudio da reunião (o que o Chromium toca) gravando o MONITOR do sink
 * PulseAudio em WAV 16 kHz mono (formato que o Whisper espera). O Chromium desta
 * reunião toca no sink dedicado (via `PULSE_SINK`); aqui gravamos o `<sink>.monitor`.
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
