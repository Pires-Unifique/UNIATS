import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { z } from 'zod';

import { AssemblyAIClient } from '../../assemblyai/assemblyai.client.js';
import { CryptoService } from '../../crypto/crypto.service.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { QUEUE_NAMES } from '../../../queue/queue.module.js';
import { StorageService } from '../../storage/storage.service.js';

const PayloadSchema = z.object({
  entrevistaId: z.string().uuid(),
  storageKey: z.string().min(1),
});
export type TranscricaoPayload = z.infer<typeof PayloadSchema>;

@Processor(QUEUE_NAMES.TRANSCRICAO, {
  concurrency: Number(process.env.TRANSCRICAO_CONCURRENCY ?? 1),
})
export class TranscricaoProcessor extends WorkerHost {
  private readonly logger = new Logger(TranscricaoProcessor.name);
  private readonly publicBaseUrl: string;

  constructor(
    private readonly storage: StorageService,
    private readonly crypto: CryptoService,
    private readonly assembly: AssemblyAIClient,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    super();
    this.publicBaseUrl =
      this.config.get<string>('PUBLIC_BASE_URL') ??
      'http://localhost:3001';
  }

  async process(job: Job<unknown>): Promise<{
    entrevistaId: string;
    transcriptId: string;
  }> {
    const parsed = PayloadSchema.safeParse(job.data);
    if (!parsed.success) {
      throw new Error('Payload inválido para transcricao.');
    }
    const { entrevistaId, storageKey } = parsed.data;

    const existente = await this.prisma.transcricao.findUnique({
      where: { entrevista_id: entrevistaId },
      select: { id: true, provider_id: true },
    });
    if (existente?.provider_id) {
      this.logger.log(
        `Transcrição já criada para entrevista ${entrevistaId} (provider_id=${existente.provider_id}) — pulando.`,
      );
      return { entrevistaId, transcriptId: existente.provider_id };
    }

    // 1. Lê o áudio criptografado do storage
    const obj = await this.storage.getObject(storageKey);

    // 2. Descriptografa (AAD = entrevistaId — bate com o que o audio-process gravou)
    const aad = Buffer.from(entrevistaId, 'utf8');
    const audio = this.crypto.decrypt(obj.body, aad);

    const mime = obj.metadata?.mimeOriginal ?? 'application/octet-stream';

    // 3. Upload para o AssemblyAI (gera upload_url temporária)
    const uploadUrl = await this.assembly.uploadAudio(audio, mime);

    // 4. Cria job de transcrição com webhook
    const webhookUrl = `${this.publicBaseUrl.replace(/\/$/, '')}/webhooks/assemblyai`;
    const out = await this.assembly.criarTranscricao({
      audioUrl: uploadUrl,
      webhookUrl,
      entrevistaId,
    });

    // 5. Persiste placeholder de Transcricao com provider_id (correlaciona com webhook)
    const retencaoDias = Number(
      this.config.get<string>('RETENCAO_TRANSCRICAO_DIAS') ?? '365',
    );
    const expira = new Date(Date.now() + retencaoDias * 24 * 3600_000);

    await this.prisma.transcricao.upsert({
      where: { entrevista_id: entrevistaId },
      create: {
        entrevista_id: entrevistaId,
        provider: 'assemblyai',
        provider_id: out.id,
        idioma: 'pt-BR',
        texto_completo: '',
        segmentos: [] as unknown as object,
        expira_em: expira,
      },
      update: {
        provider_id: out.id,
        expira_em: expira,
      },
    });

    this.logger.log(
      `Transcrição AssemblyAI criada: entrevista=${entrevistaId} id=${out.id} status=${out.status}`,
    );

    return { entrevistaId, transcriptId: out.id };
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error): void {
    this.logger.error(
      `transcricao falhou (job ${job?.id}, tentativa ${job?.attemptsMade}): ${err.message}`,
    );
  }
}
