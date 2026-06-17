import { Worker, type Job } from 'bullmq';
import { z } from 'zod';

import { enviarTranscricao } from './api-callback.js';
import { capturarReuniao } from './teams-meeting.js';
import { criarLogger } from './logger.js';
import { loadConfig } from './config.js';

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
        },
        log,
      );

      if (!resultado.texto.trim()) {
        // Sem texto: não devolve (deixa o Graph/manual cobrir). Loga p/ diagnóstico.
        log.warn(
          { entrou: resultado.entrou, legendasLigadas: resultado.legendasLigadas },
          'Captura sem texto — nada a enviar.',
        );
        return { ok: false, segmentos: 0 };
      }

      await enviarTranscricao(cfg.API_INTERNAL_URL, cfg.PLAYWRIGHT_CALLBACK_SECRET, {
        entrevistaId: payload.entrevistaId,
        texto: resultado.texto,
        segmentos: resultado.segmentos,
        entrou: resultado.entrou,
        legendasLigadas: resultado.legendasLigadas,
      });
      log.info({ segmentos: resultado.segmentos.length }, 'Transcrição enviada à API.');
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
