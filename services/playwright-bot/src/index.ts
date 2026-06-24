import { Worker, type Job } from 'bullmq';
import { unlinkSync } from 'node:fs';
import { z } from 'zod';

import { enviarTranscricao } from './api-callback.js';
import { capturarReuniao, type Segmento } from './teams-meeting.js';
import { criarLogger } from './logger.js';
import { loadConfig } from './config.js';
import { transcreverComWhisper, wavTemConteudo } from './whisper.js';

const PayloadSchema = z.object({
  entrevistaId: z.string().uuid(),
  joinUrl: z.string().url(),
  /** Sobrescreve o nome exibido do bot (opcional). */
  displayName: z.string().min(1).optional(),
  /** Teto de duração específico desta reunião (min) — senão usa o default global. */
  maxDuracaoMin: z.number().int().positive().optional(),
});

async function main(): Promise<void> {
  const cfg = loadConfig();
  const logger = criarLogger({ level: cfg.LOG_LEVEL, pretty: cfg.LOG_PRETTY });

  logger.info(
    { fila: cfg.PLAYWRIGHT_QUEUE, prefix: cfg.REDIS_QUEUE_PREFIX, headless: cfg.PLAYWRIGHT_HEADLESS },
    'Bot Playwright iniciando…',
  );

  const worker = new Worker(
    cfg.PLAYWRIGHT_QUEUE,
    async (job: Job) => {
      const payload = PayloadSchema.parse(job.data);
      const log = logger.child({ entrevistaId: payload.entrevistaId, jobId: job.id });
      log.info('Recebido job de join.');

      const wavPath = cfg.WHISPER_ENABLED
        ? `/tmp/pw-${payload.entrevistaId}.wav`
        : undefined;
      const resultado = await capturarReuniao(
        {
          joinUrl: payload.joinUrl,
          displayName: payload.displayName ?? cfg.PLAYWRIGHT_DISPLAY_NAME,
          headless: cfg.PLAYWRIGHT_HEADLESS,
          navTimeoutMs: cfg.PLAYWRIGHT_NAV_TIMEOUT_MS,
          lobbyTimeoutMs: cfg.PLAYWRIGHT_LOBBY_TIMEOUT_MS,
          maxDuracaoMin: payload.maxDuracaoMin ?? cfg.PLAYWRIGHT_MAX_DURACAO_MIN,
          ociosidadeMin: cfg.PLAYWRIGHT_OCIOSIDADE_MIN,
          captionLang: cfg.PLAYWRIGHT_CAPTION_LANG,
          wavPath,
          audioSink: cfg.WHISPER_ENABLED ? cfg.MEETBOT_AUDIO_SINK : undefined,
        },
        log,
      );

      // 2º motor: Whisper no áudio capturado (já com o Chromium fechado — poupa RAM).
      let whisperSegmentos: Segmento[] = [];
      if (resultado.wavPath && wavTemConteudo(resultado.wavPath)) {
        whisperSegmentos = await transcreverComWhisper(
          resultado.wavPath,
          { script: cfg.WHISPER_SCRIPT, model: cfg.WHISPER_MODEL, lang: cfg.WHISPER_LANG },
          log,
        );
      }
      if (resultado.wavPath) {
        try {
          unlinkSync(resultado.wavPath);
        } catch {
          /* já removido / nunca criado */
        }
      }

      if (!resultado.texto.trim() && whisperSegmentos.length === 0) {
        log.warn(
          { entrou: resultado.entrou, legendasLigadas: resultado.legendasLigadas },
          'Captura sem texto (legenda e Whisper) — nada a enviar.',
        );
        return { ok: false, segmentos: 0 };
      }

      await enviarTranscricao(cfg.API_INTERNAL_URL, cfg.PLAYWRIGHT_CALLBACK_SECRET, {
        entrevistaId: payload.entrevistaId,
        texto: resultado.texto,
        segmentos: resultado.segmentos,
        whisperSegmentos,
        entrou: resultado.entrou,
        legendasLigadas: resultado.legendasLigadas,
      });
      log.info(
        { legendas: resultado.segmentos.length, whisper: whisperSegmentos.length },
        'Transcrição enviada à API.',
      );
      return { ok: true, segmentos: resultado.segmentos.length };
    },
    {
      connection: { url: cfg.REDIS_URL } as never,
      prefix: cfg.REDIS_QUEUE_PREFIX,
      concurrency: cfg.PLAYWRIGHT_CONCURRENCY,
      // Reunião é demorada — não deixar o BullMQ considerar o job "travado".
      lockDuration: 4 * 60 * 60_000,
    },
  );

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err: err.message }, 'Job de join falhou.');
  });
  worker.on('completed', (job) => {
    logger.info({ jobId: job.id }, 'Job de join concluído.');
  });

  const encerrar = async (sinal: string): Promise<void> => {
    logger.info({ sinal }, 'Encerrando worker…');
    await worker.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void encerrar('SIGTERM'));
  process.on('SIGINT', () => void encerrar('SIGINT'));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Falha fatal ao iniciar o bot:', err);
  process.exit(1);
});
