import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { z } from 'zod';

import { GupyClient } from '../../gupy/gupy.client.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { QUEUE_NAMES } from '../../../queue/queue.module.js';
import { StorageService } from '../../storage/storage.service.js';
import {
  CONTENT_TYPES_SUPORTADOS,
} from '../parsers/parser.types.js';

/**
 * Payload enfileirado pelo módulo Gupy (Camada 1).
 * Esquema explícito para falhar cedo se o enqueuer mudar o shape sem alinhar.
 */
const PayloadSchema = z.object({
  candidaturaId: z.string().uuid(),
  candidatoId: z.string().uuid(),
  url: z.string().url().startsWith('https://'),
});
export type CvDownloadPayload = z.infer<typeof PayloadSchema>;

const EXT_POR_CONTENT_TYPE: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    'docx',
  'application/msword': 'doc',
  'text/plain': 'txt',
};

@Processor(QUEUE_NAMES.CV_DOWNLOAD, {
  concurrency: Number(process.env.CV_DOWNLOAD_CONCURRENCY ?? 3),
})
export class CvDownloadProcessor extends WorkerHost {
  private readonly logger = new Logger(CvDownloadProcessor.name);
  private readonly maxSizeBytes: number;

  constructor(
    private readonly gupy: GupyClient,
    private readonly storage: StorageService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @InjectQueue(QUEUE_NAMES.CV_PARSE) private readonly filaParse: Queue,
  ) {
    super();
    this.maxSizeBytes = this.config.getOrThrow<number>('CV_MAX_SIZE_BYTES');
  }

  async process(job: Job<unknown>): Promise<{ key: string; sha256: string }> {
    const parsed = PayloadSchema.safeParse(job.data);
    if (!parsed.success) {
      this.logger.error(
        `Payload inválido em cv-download (job ${job.id}): ${parsed.error.message}`,
      );
      // Não relança como erro recuperável — payload inválido é bug, não transiente.
      throw new Error('Payload inválido para cv-download.');
    }
    const { candidaturaId, candidatoId, url } = parsed.data;

    // Idempotência aplicacional: se já existe currículo persistido para esta
    // candidatura E o arquivo está no storage, pulamos download e re-enfileiramos parse.
    const existente = await this.prisma.curriculoProcessado.findUnique({
      where: { candidatura_id: candidaturaId },
      select: { id: true, arquivo_sha256: true, arquivo_url: true },
    });

    if (existente?.arquivo_url && existente.arquivo_sha256) {
      const jaNoStorage = await this.storage.exists(existente.arquivo_url);
      if (jaNoStorage) {
        this.logger.debug(
          `Currículo já baixado (candidatura ${candidaturaId}). Re-enfileirando parse.`,
        );
        await this.enfileirarParse(candidaturaId, existente.arquivo_url);
        return { key: existente.arquivo_url, sha256: existente.arquivo_sha256 };
      }
    }

    // Download via GupyClient — SSRF guard + rate limiter já estão lá.
    const { data, contentType } = await this.gupy.baixarCurriculo(url);

    if (data.length === 0) {
      throw new Error('Currículo baixado está vazio.');
    }
    if (data.length > this.maxSizeBytes) {
      throw new Error(
        `Currículo excede tamanho máximo: ${data.length} > ${this.maxSizeBytes} bytes.`,
      );
    }

    const tipoNormalizado = contentType.toLowerCase().split(';')[0].trim();
    if (!CONTENT_TYPES_SUPORTADOS.includes(tipoNormalizado)) {
      throw new Error(
        `Content-Type não suportado para currículo: "${tipoNormalizado}"`,
      );
    }

    const ext = EXT_POR_CONTENT_TYPE[tipoNormalizado] ?? 'bin';

    // O SHA-256 é calculado dentro do StorageService — precisamos dele para a key,
    // então fazemos o cálculo aqui também (operação O(n) barata, ~50ms para 5MB).
    const { createHash } = await import('node:crypto');
    const sha256 = createHash('sha256').update(data).digest('hex');

    const key = this.storage.buildKey({
      kind: 'curriculo',
      sha256,
      extension: ext,
    });

    const put = await this.storage.putObject(key, {
      body: data,
      contentType: tipoNormalizado,
      metadata: { candidaturaId, candidatoId },
    });

    // Upsert provisório: cria/atualiza registro com texto_bruto = '' até o parse rodar.
    // Schema exige texto_bruto NOT NULL, então usamos string vazia como sentinel.
    await this.prisma.curriculoProcessado.upsert({
      where: { candidatura_id: candidaturaId },
      create: {
        candidatura_id: candidaturaId,
        candidato_id: candidatoId,
        arquivo_url: put.key,
        arquivo_sha256: put.sha256,
        texto_bruto: '',
        texto_normalizado: '',
        parser_versao: 'pending',
      },
      update: {
        arquivo_url: put.key,
        arquivo_sha256: put.sha256,
        // Se sha mudou, invalidamos parser_versao para forçar reprocesso.
        parser_versao:
          existente?.arquivo_sha256 === put.sha256 ? undefined : 'pending',
      },
    });

    await this.enfileirarParse(candidaturaId, put.key);

    this.logger.log(
      `CV baixado: candidatura=${candidaturaId} key=${put.key} size=${put.size}`,
    );

    return { key: put.key, sha256: put.sha256 };
  }

  private async enfileirarParse(
    candidaturaId: string,
    storageKey: string,
  ): Promise<void> {
    await this.filaParse.add(
      'parse-cv',
      { candidaturaId, storageKey },
      {
        jobId: `cv-parse-${candidaturaId}`,
        // Idempotência: se já houver um job parse pendente com esse jobId,
        // BullMQ ignora silenciosamente o segundo enqueue.
      },
    );
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error): void {
    this.logger.error(
      `cv-download falhou (job ${job?.id}, tentativa ${job?.attemptsMade}): ${err.message}`,
    );
  }
}
