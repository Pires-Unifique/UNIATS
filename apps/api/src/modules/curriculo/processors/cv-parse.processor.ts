import { Processor, WorkerHost, OnWorkerEvent, InjectQueue } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Prisma } from '@uniats/db';
import type { Job, Queue } from 'bullmq';
import { z } from 'zod';

import { ClaudeService } from '../../claude/claude.service.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { ParserService } from '../parsers/parser.service.js';
import { QUEUE_NAMES } from '../../../queue/queue.module.js';
import { StorageService } from '../../storage/storage.service.js';

const PayloadSchema = z.object({
  candidaturaId: z.string().uuid(),
  storageKey: z.string().min(1),
});
export type CvParsePayload = z.infer<typeof PayloadSchema>;

@Processor(QUEUE_NAMES.CV_PARSE, {
  concurrency: Number(process.env.CV_PARSE_CONCURRENCY ?? 2),
})
export class CvParseProcessor extends WorkerHost {
  private readonly logger = new Logger(CvParseProcessor.name);

  constructor(
    private readonly storage: StorageService,
    private readonly parser: ParserService,
    private readonly claude: ClaudeService,
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_NAMES.EMBEDDING) private readonly filaEmbedding: Queue,
  ) {
    super();
  }

  async process(
    job: Job<unknown>,
  ): Promise<{ candidaturaId: string; parserVersao: string }> {
    const parsed = PayloadSchema.safeParse(job.data);
    if (!parsed.success) {
      this.logger.error(
        `Payload inválido em cv-parse (job ${job.id}): ${parsed.error.message}`,
      );
      throw new Error('Payload inválido para cv-parse.');
    }
    const { candidaturaId, storageKey } = parsed.data;

    // Lê metadados antes de baixar conteúdo — permite skip se já processado.
    const registro = await this.prisma.curriculoProcessado.findUnique({
      where: { candidatura_id: candidaturaId },
      select: {
        id: true,
        parser_versao: true,
        arquivo_url: true,
      },
    });

    if (!registro) {
      // Race condition rara: parse rodou antes do upsert do download terminar.
      // Falha com erro recuperável → BullMQ tenta de novo com backoff.
      throw new Error(
        `Registro de currículo não existe ainda para candidatura ${candidaturaId} — re-tentando.`,
      );
    }

    // 1. Baixa do storage
    const obj = await this.storage.getObject(storageKey);

    // 2. Extrai texto (PDF/DOCX/TXT)
    const extraido = await this.parser.extrairTexto(obj.body, obj.contentType);

    // 3. Estrutura com Claude (tool-use → JSON validado por Zod)
    const llm = await this.claude.estruturarCurriculo(extraido.normalizado);

    // 4. Persiste tudo numa única transação — evita estado intermediário.
    await this.prisma.curriculoProcessado.update({
      where: { candidatura_id: candidaturaId },
      data: {
        texto_bruto: extraido.bruto,
        texto_normalizado: extraido.normalizado,
        resumo: llm.estruturado.resumo,
        experiencias:
          llm.estruturado.experiencias as unknown as Prisma.InputJsonValue,
        formacoes:
          llm.estruturado.formacoes as unknown as Prisma.InputJsonValue,
        competencias: llm.estruturado.competencias,
        idiomas: llm.estruturado.idiomas as unknown as Prisma.InputJsonValue,
        certificacoes:
          llm.estruturado.certificacoes as unknown as Prisma.InputJsonValue,
        anos_experiencia: llm.estruturado.anos_experiencia,
        parser_versao: llm.parserVersao,
      },
    });

    // 5. Enfileira geração de embeddings (Camada 3 — placeholder de payload).
    // O worker de embedding ainda não existe; quando existir, ele lê
    // texto_normalizado direto do banco usando candidaturaId.
    await this.filaEmbedding.add(
      'embedding-curriculo',
      { candidaturaId, alvo: 'curriculo' },
      { jobId: `emb-cv-${candidaturaId}` },
    );

    this.logger.log(
      `CV parseado: candidatura=${candidaturaId} parser=${llm.parserVersao} ` +
        `tokens_in=${llm.tokensEntrada} tokens_out=${llm.tokensSaida}`,
    );

    return { candidaturaId, parserVersao: llm.parserVersao };
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, err: Error): void {
    this.logger.error(
      `cv-parse falhou (job ${job?.id}, tentativa ${job?.attemptsMade}): ${err.message}`,
    );
  }
}
