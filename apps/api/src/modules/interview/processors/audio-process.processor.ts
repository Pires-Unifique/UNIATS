import { InjectQueue, OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Job, Queue } from 'bullmq';
import { z } from 'zod';

import { CryptoService } from '../../crypto/crypto.service.js';
import { MeetStreamClient } from '../../meetstream/meetstream.client.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { QUEUE_NAMES } from '../../../queue/queue.module.js';
import { StorageService } from '../../storage/storage.service.js';

const PayloadSchema = z.object({
  entrevistaId: z.string().uuid(),
  botId: z.string().min(1),
});
export type AudioProcessPayload = z.infer<typeof PayloadSchema>;

const MIMES_PERMITIDOS = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/wave',
  'audio/x-wav',
  'audio/mp4',
  'audio/m4a',
  'audio/ogg',
  'audio/webm',
]);

@Processor(QUEUE_NAMES.AUDIO_PROCESS, {
  concurrency: Number(process.env.AUDIO_PROCESS_CONCURRENCY ?? 1),
})
export class AudioProcessProcessor extends WorkerHost {
  private readonly logger = new Logger(AudioProcessProcessor.name);
  private readonly retencaoDias: number;
  private readonly maxBytes: number;

  constructor(
    private readonly meetstream: MeetStreamClient,
    private readonly storage: StorageService,
    private readonly crypto: CryptoService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @InjectQueue(QUEUE_NAMES.TRANSCRICAO)
    private readonly filaTranscricao: Queue,
  ) {
    super();
    this.retencaoDias = Number(
      this.config.get<string>('RETENCAO_AUDIO_DIAS') ?? '90',
    );
    this.maxBytes = Number(
      this.config.get<string>('AUDIO_MAX_BYTES') ?? `${200 * 1024 * 1024}`,
    );
  }

  async process(job: Job<unknown>): Promise<{ storageKey: string; sha256: string }> {
    const parsed = PayloadSchema.safeParse(job.data);
    if (!parsed.success) {
      throw new Error('Payload inválido para audio-process.');
    }
    const { entrevistaId, botId } = parsed.data;

    const entrevista = await this.prisma.entrevista.findUnique({
      where: { id: entrevistaId },
      select: { id: true, audio_url: true, audio_sha256: true },
    });
    if (!entrevista) {
      throw new Error(`Entrevista ${entrevistaId} não existe.`);
    }
    if (entrevista.audio_url && entrevista.audio_sha256) {
      // Idempotência: já processado anteriormente, re-enfileira transcrição.
      this.logger.log(
        `Áudio da entrevista ${entrevistaId} já está no storage — só re-enfileirando transcrição.`,
      );
      await this.enfileirarTranscricao(entrevistaId, entrevista.audio_url);
      return {
        storageKey: entrevista.audio_url,
        sha256: entrevista.audio_sha256,
      };
    }

    // 1. Pega URL temporária da gravação no MeetStream
    const meta = await this.meetstream.obterGravacao(botId);
    if (!meta?.url) {
      throw new Error(
        `MeetStream ainda não disponibilizou gravação para bot ${botId}.`,
      );
    }

    // 2. Baixa o áudio
    const { data, contentType } = await this.meetstream.baixarAudio(meta.url);

    const tipo = contentType.toLowerCase().split(';')[0].trim();
    if (!MIMES_PERMITIDOS.has(tipo)) {
      throw new Error(`Content-Type de áudio não suportado: ${tipo}`);
    }
    if (data.length === 0) {
      throw new Error('Áudio baixado está vazio.');
    }
    if (data.length > this.maxBytes) {
      throw new Error(
        `Áudio excede tamanho máximo: ${data.length} > ${this.maxBytes} bytes.`,
      );
    }

    // 3. SHA-256 do áudio em claro (para integridade) — auditável independente da chave.
    const sha256 = createHash('sha256').update(data).digest('hex');

    // 4. Criptografa com AES-256-GCM. AAD vincula o ciphertext à entrevista —
    //    impede que alguém mova o blob entre entrevistas.
    const aad = Buffer.from(entrevistaId, 'utf8');
    const encrypted = this.crypto.encrypt(data, aad);

    // 5. Persiste no storage com extensão `enc` (payload cifrado).
    //    O MIME original é guardado na metadata para que o TranscricaoProcessor
    //    saiba como entregar ao AssemblyAI.
    const mimeOriginal = this.normalizarMime(tipo);
    const key = this.storage.buildKey({
      kind: 'audio',
      sha256, // sha do PLAINTEXT — necessário para idempotência e auditoria
      extension: 'enc',
    });
    await this.storage.putObject(key, {
      body: encrypted.bytes,
      contentType: 'application/octet-stream',
      metadata: {
        entrevistaId,
        algoritmo: 'aes-256-gcm',
        mimeOriginal,
        // Tamanho do plaintext fica registrado para auditoria de retenção.
        plaintextLen: String(data.length),
      },
    });

    // 6. Atualiza entrevista + audio_expira_em (retenção LGPD).
    const expiraEm = new Date(
      Date.now() + this.retencaoDias * 24 * 3600_000,
    );
    await this.prisma.entrevista.update({
      where: { id: entrevistaId },
      data: {
        audio_url: key,
        audio_sha256: sha256,
        audio_expira_em: expiraEm,
        finalizada_em: new Date(),
        status: 'FINALIZADA',
        bot_status: 'ended',
      },
    });

    // 7. Enfileira transcrição
    await this.enfileirarTranscricao(entrevistaId, key);

    this.logger.log(
      `Áudio processado: entrevista=${entrevistaId} bytes=${data.length} sha=${sha256.slice(0, 12)}… expira=${expiraEm.toISOString()}`,
    );

    return { storageKey: key, sha256 };
  }

  private async enfileirarTranscricao(
    entrevistaId: string,
    storageKey: string,
  ): Promise<void> {
    await this.filaTranscricao.add(
      'transcrever',
      { entrevistaId, storageKey },
      { jobId: `transcricao-${entrevistaId}` },
    );
  }

  private normalizarMime(mime: string): string {
    if (mime.includes('mpeg') || mime.includes('mp3')) return 'audio/mpeg';
    if (mime.includes('wav')) return 'audio/wav';
    if (mime.includes('mp4') || mime.includes('m4a')) return 'audio/mp4';
    if (mime.includes('ogg')) return 'audio/ogg';
    if (mime.includes('webm')) return 'audio/webm';
    return 'application/octet-stream';
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error): void {
    this.logger.error(
      `audio-process falhou (job ${job?.id}, tentativa ${job?.attemptsMade}): ${err.message}`,
    );
  }
}
