import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';

// Mock @aws-sdk/client-s3 antes do import do service.
const sendMock = jest.fn();
jest.mock('@aws-sdk/client-s3', () => {
  class S3Client {
    send = sendMock;
  }
  class CommandStub<T> {
    constructor(public readonly input: T) {}
  }
  class S3ServiceException extends Error {
    $metadata: { httpStatusCode?: number } = {};
  }
  return {
    __esModule: true,
    S3Client,
    GetObjectCommand: CommandStub,
    PutObjectCommand: CommandStub,
    HeadObjectCommand: CommandStub,
    HeadBucketCommand: CommandStub,
    CreateBucketCommand: CommandStub,
    S3ServiceException,
  };
});

import { StorageService } from '../storage.service.js';

function configMock(): ConfigService {
  const map: Record<string, unknown> = {
    STORAGE_ENDPOINT: 'http://localhost:9000',
    STORAGE_REGION: 'us-east-1',
    STORAGE_ACCESS_KEY: 'k',
    STORAGE_SECRET_KEY: 'secret123',
    STORAGE_FORCE_PATH_STYLE: 'true',
    STORAGE_BUCKET: 'triagem',
    NODE_ENV: 'test',
  };
  return {
    getOrThrow: <T>(k: string) => map[k] as T,
    get: <T>(k: string) => map[k] as T,
  } as unknown as ConfigService;
}

describe('StorageService', () => {
  let service: StorageService;

  beforeEach(() => {
    sendMock.mockReset();
    service = new StorageService(configMock());
  });

  describe('buildKey', () => {
    it('monta key com kind + 2 níveis de shard + sha256.ext', () => {
      const sha =
        'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
      const key = service.buildKey({ kind: 'curriculo', sha256: sha, extension: 'pdf' });
      expect(key).toBe(`curriculo/ab/cd/${sha}.pdf`);
    });

    it('normaliza extensão (remove ponto, lowercase)', () => {
      const sha = 'f'.repeat(64);
      expect(
        service.buildKey({ kind: 'curriculo', sha256: sha, extension: '.PDF' }),
      ).toMatch(/\.pdf$/);
    });

    it('rejeita extensão suspeita', () => {
      const sha = 'f'.repeat(64);
      expect(() =>
        service.buildKey({ kind: 'curriculo', sha256: sha, extension: '../etc/passwd' }),
      ).toThrow(/inválida/);
    });

    it('rejeita SHA inválido', () => {
      expect(() =>
        service.buildKey({ kind: 'curriculo', sha256: 'short', extension: 'pdf' }),
      ).toThrow(/SHA-256/);
    });
  });

  describe('putObject', () => {
    it('é idempotente — se HEAD encontra o objeto, pula o PUT', async () => {
      sendMock.mockImplementation((cmd: any) => {
        if (cmd.constructor.name === 'CommandStub') {
          // HEAD retorna 200
          if ('Bucket' in cmd.input && !cmd.input.Body) {
            return Promise.resolve({
              ContentLength: 42,
              ETag: '"abc"',
            });
          }
        }
        return Promise.reject(new Error('Não deveria PUT'));
      });

      const res = await service.putObject('curriculo/aa/bb/sha.pdf', {
        body: Buffer.from('hello'),
        contentType: 'application/pdf',
      });

      expect(res.key).toBe('curriculo/aa/bb/sha.pdf');
      expect(res.size).toBe(42);
      // 1 chamada (HEAD apenas)
      expect(sendMock).toHaveBeenCalledTimes(1);
    });

    it('faz PUT quando HEAD retorna 404', async () => {
      sendMock
        .mockImplementationOnce(() => {
          const err: any = new Error('not found');
          err.$metadata = { httpStatusCode: 404 };
          return Promise.reject(err);
        })
        .mockResolvedValueOnce({ ETag: '"new-etag"' });

      const res = await service.putObject('curriculo/aa/bb/sha.pdf', {
        body: Buffer.from('hello world'),
        contentType: 'application/pdf',
        metadata: { candidaturaId: 'c-1' },
      });

      expect(res.etag).toBe('new-etag');
      expect(res.size).toBe(11);
      expect(res.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(sendMock).toHaveBeenCalledTimes(2);

      // Confere que o PutObjectCommand recebeu SSE + metadata + sha
      const putArgs = sendMock.mock.calls[1][0].input;
      expect(putArgs.ServerSideEncryption).toBe('AES256');
      expect(putArgs.Metadata.candidaturaId).toBe('c-1');
      expect(putArgs.Metadata.sha256).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('getObject', () => {
    it('lança NotFoundException em 404', async () => {
      const err: any = new Error('nope');
      err.$metadata = { httpStatusCode: 404 };
      sendMock.mockRejectedValue(err);

      await expect(service.getObject('any')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('lê stream e devolve Buffer', async () => {
      const { Readable } = await import('node:stream');
      const stream = Readable.from([Buffer.from('hello')]);
      sendMock.mockResolvedValue({
        Body: stream,
        ContentType: 'application/pdf',
        ContentLength: 5,
        Metadata: { sha256: 'x' },
      });

      const out = await service.getObject('curriculo/aa/bb/sha.pdf');
      expect(out.body.toString()).toBe('hello');
      expect(out.contentType).toBe('application/pdf');
      expect(out.metadata?.sha256).toBe('x');
    });
  });

  describe('exists', () => {
    it('retorna true em 200', async () => {
      sendMock.mockResolvedValue({});
      await expect(service.exists('k')).resolves.toBe(true);
    });

    it('retorna false em 404', async () => {
      const err: any = new Error();
      err.$metadata = { httpStatusCode: 404 };
      sendMock.mockRejectedValue(err);
      await expect(service.exists('k')).resolves.toBe(false);
    });
  });
});
