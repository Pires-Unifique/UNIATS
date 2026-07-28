import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';

import { PrismaService } from '../../prisma/prisma.service.js';
import { QUEUE_NAMES } from '../../queue/queue.module.js';
import { StorageService } from '../storage/storage.service.js';

@Injectable()
export class CurriculoService {
  private readonly logger = new Logger(CurriculoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    @InjectQueue(QUEUE_NAMES.CV_PARSE) private readonly filaParse: Queue,
  ) {}

  async buscarPorCandidatura(candidaturaId: string) {
    const cv = await this.prisma.curriculoProcessado.findUnique({
      where: { candidatura_id: candidaturaId },
      select: {
        id: true,
        candidato_id: true,
        candidatura_id: true,
        arquivo_url: true,
        arquivo_sha256: true,
        texto_bruto: true,
        resumo: true,
        experiencias: true,
        formacoes: true,
        competencias: true,
        idiomas: true,
        certificacoes: true,
        anos_experiencia: true,
        parser_versao: true,
        processado_em: true,
        atualizado_em: true,
      },
    });
    if (!cv) {
      throw new NotFoundException(
        `Currículo não encontrado para candidatura ${candidaturaId}`,
      );
    }
    // A key do storage é detalhe interno — o front só precisa saber SE há
    // arquivo original para oferecer o download (GET .../arquivo).
    const { arquivo_url, ...resto } = cv;
    return { ...resto, tem_arquivo: Boolean(arquivo_url) };
  }

  /**
   * Arquivo ORIGINAL do currículo (PDF/DOCX/TXT baixado da Gupy), servido via
   * proxy da API — o storage não expõe presigned URL. O content-type vem do
   * metadado gravado no putObject; a extensão sai da key (…/<sha>.<ext>).
   */
  async obterArquivo(
    candidaturaId: string,
    usuario?: { id: string; chave_api?: unknown },
  ): Promise<{
    body: Buffer;
    contentType: string;
    filename: string;
  }> {
    const cv = await this.prisma.curriculoProcessado.findUnique({
      where: { candidatura_id: candidaturaId },
      select: { arquivo_url: true },
    });
    // Auditoria de acesso a PII (LGPD): quem abriu o CV completo do candidato.
    // Fire-and-forget, como em candidatura_visualizada.
    void this.prisma.registroAuditoria
      .create({
        data: {
          usuario_id: usuario && !usuario.chave_api ? usuario.id : null,
          acao: 'curriculo_arquivo_visualizado',
          entidade: 'candidatura',
          entidade_id: candidaturaId,
          diff: {},
        },
      })
      .catch(() => undefined);
    if (!cv) {
      throw new NotFoundException(
        `Currículo não encontrado para candidatura ${candidaturaId}`,
      );
    }
    if (!cv.arquivo_url) {
      throw new NotFoundException(
        'Esta candidatura não tem arquivo de currículo no storage — só o perfil estruturado da Gupy.',
      );
    }
    const obj = await this.storage.getObject(cv.arquivo_url);
    const ext = cv.arquivo_url.split('.').pop() ?? 'pdf';
    return {
      body: obj.body,
      contentType: obj.contentType,
      filename: `curriculo-${candidaturaId}.${ext}`,
    };
  }

  /**
   * Reprocessa o currículo a partir do arquivo já persistido no storage.
   * Usado quando PARSER_PROMPT_VERSION sobe ou quando o parse anterior falhou.
   *
   * NÃO refaz o download — URLs de CV da Gupy são pre-signed e expiram.
   * Se o arquivo não está no storage, o caminho correto é aguardar próxima
   * sync/webhook ou chamar `POST /api/gupy/sync` para re-importar candidaturas.
   */
  async reprocessar(
    candidaturaId: string,
  ): Promise<{ fila: 'cv-parse'; jobId: string }> {
    const cv = await this.prisma.curriculoProcessado.findUnique({
      where: { candidatura_id: candidaturaId },
      select: { arquivo_url: true },
    });
    if (!cv) {
      throw new NotFoundException(
        `Candidatura ${candidaturaId} ainda não tem currículo importado.`,
      );
    }
    if (!cv.arquivo_url) {
      throw new BadRequestException(
        'Arquivo do currículo não está disponível no storage — aguarde nova sincronização da Gupy.',
      );
    }

    const jobId = `cv-parse-${candidaturaId}-${Date.now()}`;
    await this.filaParse.add(
      'parse-cv',
      { candidaturaId, storageKey: cv.arquivo_url },
      { jobId },
    );

    this.logger.log(
      `Reprocessamento enfileirado para candidatura ${candidaturaId}.`,
    );
    return { fila: 'cv-parse', jobId };
  }
}
