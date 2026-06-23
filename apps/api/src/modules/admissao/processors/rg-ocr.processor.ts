import { Processor, WorkerHost, OnWorkerEvent, InjectQueue } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@uniats/db';
import type { Job, Queue } from 'bullmq';
import { z } from 'zod';

import { ClaudeService, RgMediaType } from '../../claude/claude.service.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { QUEUE_NAMES } from '../../../queue/queue.module.js';
import { StorageService } from '../../storage/storage.service.js';

const PayloadSchema = z.object({
  admissaoId: z.string().uuid(),
  documentoId: z.string().uuid(),
});
export type RgOcrPayload = z.infer<typeof PayloadSchema>;

/** Content-Types aceitos pela visão do Claude (imagens) + PDF. */
const MEDIA_TYPES: Record<string, RgMediaType> = {
  'image/jpeg': 'image/jpeg',
  'image/jpg': 'image/jpeg',
  'image/png': 'image/png',
  'image/webp': 'image/webp',
  'image/gif': 'image/gif',
  'application/pdf': 'application/pdf',
};

@Processor(QUEUE_NAMES.RG_OCR, {
  concurrency: Number(process.env.RG_OCR_CONCURRENCY ?? 2),
})
export class RgOcrProcessor extends WorkerHost {
  private readonly logger = new Logger(RgOcrProcessor.name);
  /** Só dispara a provisão de acesso quando há provider configurado. */
  private readonly gatilhoAcessoAtivo: boolean;

  constructor(
    private readonly storage: StorageService,
    private readonly claude: ClaudeService,
    private readonly prisma: PrismaService,
    config: ConfigService,
    @InjectQueue(QUEUE_NAMES.PROVISAO_ACESSO)
    private readonly filaProvisao: Queue,
  ) {
    super();
    this.gatilhoAcessoAtivo =
      (config.get<string>('ACESSO_PROVIDER') ?? 'desabilitado') !==
      'desabilitado';
  }

  async process(job: Job<unknown>): Promise<{ documentoId: string }> {
    const parsed = PayloadSchema.safeParse(job.data);
    if (!parsed.success) {
      this.logger.error(
        `Payload inválido em rg-ocr (job ${job.id}): ${parsed.error.message}`,
      );
      throw new Error('Payload inválido para rg-ocr.');
    }
    const { admissaoId, documentoId } = parsed.data;

    const doc = await this.prisma.documentoAdmissional.findFirst({
      where: { id: documentoId, admissao_id: admissaoId },
      select: {
        id: true,
        arquivo_url: true,
        ocr_processado_em: true,
      },
    });
    if (!doc) {
      throw new NotFoundDoc(documentoId);
    }
    if (!doc.arquivo_url) {
      throw new Error(
        `Documento ${documentoId} não tem arquivo no storage para OCR.`,
      );
    }

    // Idempotência: se já foi processado, só (re)dispara a provisão de acesso.
    if (doc.ocr_processado_em) {
      this.logger.debug(
        `RG já tinha OCR (doc ${documentoId}) — re-enfileirando provisão de acesso.`,
      );
      await this.enfileirarProvisao(admissaoId);
      return { documentoId };
    }

    const obj = await this.storage.getObject(doc.arquivo_url);
    const tipo = obj.contentType.toLowerCase().split(';')[0].trim();
    const mediaType = MEDIA_TYPES[tipo];
    if (!mediaType) {
      throw new Error(`Content-Type não suportado para OCR de RG: "${tipo}".`);
    }

    const ocr = await this.claude.extrairDadosRG({
      base64: obj.body.toString('base64'),
      mediaType,
    });

    await this.prisma.documentoAdmissional.update({
      where: { id: documentoId },
      data: {
        dados_extraidos_json: ocr.extraido as unknown as Prisma.InputJsonValue,
        ocr_versao: ocr.ocrVersao,
        ocr_processado_em: new Date(),
      },
    });

    this.logger.log(
      `RG processado por OCR: doc=${documentoId} versao=${ocr.ocrVersao} ` +
        `nome=${ocr.extraido.nome_completo ? 'ok' : 'ausente'} ` +
        `tokens_in=${ocr.tokensEntrada} tokens_out=${ocr.tokensSaida}`,
    );

    // Gatilho automático: solicita a criação do acesso de AD.
    await this.enfileirarProvisao(admissaoId);

    return { documentoId };
  }

  private async enfileirarProvisao(admissaoId: string): Promise<void> {
    // Gatilho de acesso desligado (ACESSO_PROVIDER=desabilitado): o OCR roda e
    // grava os dados do RG, mas NÃO abre/agenda chamado em ferramenta externa.
    if (!this.gatilhoAcessoAtivo) {
      this.logger.debug(
        `Gatilho de acesso desabilitado — provisão não enfileirada (admissão ${admissaoId}).`,
      );
      return;
    }
    await this.filaProvisao.add(
      'provisao-acesso',
      { admissaoId },
      { jobId: `provisao-${admissaoId}` },
    );
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error): void {
    this.logger.error(
      `rg-ocr falhou (job ${job?.id}, tentativa ${job?.attemptsMade}): ${err.message}`,
    );
  }
}

/** Erro tipado para documento inexistente (recuperável → BullMQ re-tenta). */
class NotFoundDoc extends Error {
  constructor(documentoId: string) {
    super(`Documento ${documentoId} não encontrado para OCR — re-tentando.`);
    this.name = 'NotFoundDoc';
  }
}
