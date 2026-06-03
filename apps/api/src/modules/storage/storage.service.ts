import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GetObjectCommand,
  HeadObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';

import type {
  BuildKeyInput,
  GetObjectResult,
  PutObjectInput,
  PutObjectResult,
} from './storage.types.js';

/**
 * Abstração sobre object storage compatível com S3 (MinIO em dev, S3/Azure Blob em prod).
 *
 * Princípios:
 *  - Imutabilidade: keys derivam de SHA-256 do conteúdo, garantindo idempotência.
 *  - SSE-S3 / SSE-KMS quando suportado (delegado ao provedor — não criptografamos aqui;
 *    a camada de áudio aplicará criptografia em nível de aplicação com DATA_ENCRYPTION_KEY).
 *  - Caminhos prefixados por `kind/` para retenção LGPD diferenciada.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(private readonly config: ConfigService) {
    const endpoint = this.config.get<string>('STORAGE_ENDPOINT');
    const region = this.config.get<string>('STORAGE_REGION') ?? 'us-east-1';
    const accessKeyId = this.config.getOrThrow<string>('STORAGE_ACCESS_KEY');
    const secretAccessKey = this.config.getOrThrow<string>(
      'STORAGE_SECRET_KEY',
    );
    // O schema Zod (env.validation) coage este env para BOOLEAN via
    // z.coerce.boolean(), então ConfigService devolve `true`/`false` — não a
    // string. Comparar com 'true' resultava sempre em false, forçando
    // virtual-hosted-style e quebrando o MinIO (HTTP 400). Consumir como boolean.
    const forcePathStyle =
      this.config.get<boolean>('STORAGE_FORCE_PATH_STYLE') ?? true;

    this.bucket = this.config.getOrThrow<string>('STORAGE_BUCKET');

    this.logger.debug(
      `S3Client init — endpoint=${endpoint ?? '(default AWS)'} region=${region} forcePathStyle=${forcePathStyle} bucket=${this.bucket}`,
    );

    this.client = new S3Client({
      region,
      endpoint: endpoint || undefined,
      forcePathStyle,
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  /**
   * Garante que o bucket exista. Em produção isso normalmente é provisionado
   * por IaC; em dev (MinIO) criamos para reduzir atrito.
   *
   * No boot, o MinIO pode ainda não estar acessível (corrida de inicialização
   * do docker-compose). Nesse caso o HeadBucket falha com erro de rede SEM
   * status HTTP — distinto de "bucket não existe" (404/301). Tentamos algumas
   * vezes com backoff antes de desistir, para não deixar a app sem bucket por
   * uma simples corrida de boot.
   */
  async onModuleInit(): Promise<void> {
    if (this.config.get<string>('NODE_ENV') === 'production') return;

    const MAX_TENTATIVAS = 5;
    for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
      try {
        await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
        this.logger.log(`Bucket "${this.bucket}" disponível.`);
        return;
      } catch (err) {
        const status = (err as S3ServiceException)?.$metadata?.httpStatusCode;
        if (status === 404 || status === 301) {
          // Bucket não existe (mas o MinIO respondeu) — criar e encerrar.
          await this.criarBucket();
          return;
        }
        // Sem status HTTP = erro de conexão (MinIO ainda subindo). Retry.
        if (tentativa < MAX_TENTATIVAS) {
          const esperaMs = 500 * 2 ** (tentativa - 1); // 0.5s, 1s, 2s, 4s
          this.logger.warn(
            `Storage indisponível (tentativa ${tentativa}/${MAX_TENTATIVAS}): ` +
              `${(err as Error).message} — retry em ${esperaMs}ms`,
          );
          await new Promise((r) => setTimeout(r, esperaMs));
        } else {
          this.logger.error(
            `Falha ao verificar bucket "${this.bucket}" após ${MAX_TENTATIVAS} ` +
              `tentativas: ${(err as Error).message}`,
          );
        }
      }
    }
  }

  private async criarBucket(): Promise<void> {
    this.logger.warn(`Bucket "${this.bucket}" não existe — criando...`);
    try {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
      this.logger.log(`Bucket "${this.bucket}" criado.`);
    } catch (createErr) {
      this.logger.error(
        `Falha ao criar bucket "${this.bucket}": ${(createErr as Error).message}`,
      );
    }
  }

  /**
   * Constrói uma key determinística com base no SHA-256 do conteúdo.
   * Estrutura: `<kind>/<aa>/<bb>/<sha256>.<ext>` — 256² subpastas evita
   * hotspot e mantém listagens curtas no MinIO.
   */
  buildKey({ kind, sha256, extension }: BuildKeyInput): string {
    const ext = extension.replace(/^\./, '').toLowerCase();
    if (!/^[a-z0-9]{1,8}$/.test(ext)) {
      throw new Error(`Extensão inválida: "${extension}"`);
    }
    if (!/^[0-9a-f]{64}$/i.test(sha256)) {
      throw new Error('SHA-256 deve ter 64 caracteres hexadecimais.');
    }
    const a = sha256.slice(0, 2);
    const b = sha256.slice(2, 4);
    return `${kind}/${a}/${b}/${sha256}.${ext}`;
  }

  /**
   * Upload idempotente. Calcula SHA-256, monta key, e faz PUT.
   * Se o objeto já existir (mesmo sha256), retorna a key sem reescrever.
   */
  async putObject(
    key: string,
    { body, contentType, metadata }: PutObjectInput,
  ): Promise<PutObjectResult> {
    const sha256 = createHash('sha256').update(body).digest('hex');

    // Idempotência: HEAD antes do PUT. Em alta concorrência o PUT é seguro
    // mesmo se outro escritor chegou primeiro (mesmo conteúdo = mesmo sha).
    try {
      const head = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      const size = Number(head.ContentLength ?? body.length);
      this.logger.debug(
        `Objeto já existe (key=${key}, size=${size}) — skip PUT.`,
      );
      return {
        bucket: this.bucket,
        key,
        sha256,
        etag: head.ETag?.replace(/"/g, ''),
        size,
      };
    } catch (err) {
      const status = (err as S3ServiceException)?.$metadata?.httpStatusCode;
      if (status !== 404 && status !== 403) {
        // 403 em alguns provedores significa "não existe + sem permissão de list".
        this.logger.error(
          `HEAD falhou para key=${key}: ${(err as Error).message}`,
        );
        throw new InternalServerErrorException(
          'Falha ao verificar objeto no storage.',
        );
      }
    }

    try {
      const res = await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          ContentLength: body.length,
          // Provedor cuida da criptografia em repouso (SSE-S3/SSE-KMS).
          // Para conteúdo de áudio aplicaremos AES-256-GCM em camada superior.
          ServerSideEncryption: 'AES256',
          Metadata: {
            sha256,
            ...(metadata ?? {}),
          },
        }),
      );
      return {
        bucket: this.bucket,
        key,
        sha256,
        etag: res.ETag?.replace(/"/g, ''),
        size: body.length,
      };
    } catch (err) {
      this.logger.error(
        `PUT falhou para key=${key}: ${(err as Error).message}`,
      );
      throw new InternalServerErrorException(
        'Falha ao gravar objeto no storage.',
      );
    }
  }

  /**
   * Baixa um objeto completo para Buffer. Use somente para payloads ≤ 25MB.
   * Para áudios grandes, prefira um método de streaming (será adicionado na Camada 4).
   */
  async getObject(key: string): Promise<GetObjectResult> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      const body = await this.streamToBuffer(res.Body as Readable);
      return {
        body,
        contentType: res.ContentType ?? 'application/octet-stream',
        size: Number(res.ContentLength ?? body.length),
        metadata: res.Metadata,
      };
    } catch (err) {
      const status = (err as S3ServiceException)?.$metadata?.httpStatusCode;
      if (status === 404) {
        throw new NotFoundException(`Objeto não encontrado: ${key}`);
      }
      this.logger.error(
        `GET falhou para key=${key}: ${(err as Error).message}`,
      );
      throw new InternalServerErrorException(
        'Falha ao ler objeto no storage.',
      );
    }
  }

  /**
   * Verifica existência sem baixar conteúdo.
   */
  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return true;
    } catch (err) {
      const status = (err as S3ServiceException)?.$metadata?.httpStatusCode;
      if (status === 404 || status === 403) return false;
      throw err;
    }
  }

  private async streamToBuffer(stream: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(
        Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array),
      );
    }
    return Buffer.concat(chunks);
  }
}
