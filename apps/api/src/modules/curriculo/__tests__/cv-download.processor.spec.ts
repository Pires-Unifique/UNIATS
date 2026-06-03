import { ConfigService } from '@nestjs/config';
import type { Job, Queue } from 'bullmq';

import { CvDownloadProcessor } from '../processors/cv-download.processor.js';
import { GupyClient } from '../../gupy/gupy.client.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { StorageService } from '../../storage/storage.service.js';

function fakeJob(data: unknown, id = '1'): Job<unknown> {
  return { id, data, attemptsMade: 0 } as Job<unknown>;
}

function configMock(maxBytes = 15 * 1024 * 1024): ConfigService {
  return {
    getOrThrow: () => maxBytes,
    get: () => maxBytes,
  } as unknown as ConfigService;
}

describe('CvDownloadProcessor', () => {
  let gupy: jest.Mocked<GupyClient>;
  let storage: jest.Mocked<StorageService>;
  let prisma: any;
  let filaParse: jest.Mocked<Queue>;
  let processor: CvDownloadProcessor;

  const candidaturaId = '00000000-0000-4000-8000-000000000010';
  const candidatoId = '00000000-0000-4000-8000-000000000020';
  const url = 'https://gupy.example.com/cv/abc.pdf';

  beforeEach(() => {
    gupy = {
      baixarCurriculo: jest.fn(),
    } as unknown as jest.Mocked<GupyClient>;

    storage = {
      exists: jest.fn(),
      buildKey: jest.fn(
        ({ kind, sha256, extension }) =>
          `${kind}/${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}.${extension}`,
      ),
      putObject: jest.fn(),
    } as unknown as jest.Mocked<StorageService>;

    prisma = {
      curriculoProcessado: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
      },
    };

    filaParse = { add: jest.fn() } as unknown as jest.Mocked<Queue>;

    processor = new CvDownloadProcessor(
      gupy,
      storage,
      prisma as PrismaService,
      configMock(),
      filaParse,
    );
  });

  it('rejeita payload inválido', async () => {
    await expect(
      processor.process(fakeJob({ candidaturaId: 'x', candidatoId: 'y', url: 'ftp://' })),
    ).rejects.toThrow(/Payload inválido/);
  });

  it('rejeita URL não-HTTPS no payload (Zod startsWith)', async () => {
    await expect(
      processor.process(
        fakeJob({ candidaturaId, candidatoId, url: 'http://x.com/cv.pdf' }),
      ),
    ).rejects.toThrow(/Payload inválido/);
  });

  it('quando o CV já está no storage, pula download e re-enfileira parse', async () => {
    prisma.curriculoProcessado.findUnique.mockResolvedValue({
      id: 'cv-1',
      arquivo_sha256: 'f'.repeat(64),
      arquivo_url: 'curriculo/ff/ff/sha.pdf',
    });
    storage.exists.mockResolvedValue(true);

    const out = await processor.process(
      fakeJob({ candidaturaId, candidatoId, url }),
    );

    expect(gupy.baixarCurriculo).not.toHaveBeenCalled();
    expect(filaParse.add).toHaveBeenCalledWith(
      'parse-cv',
      { candidaturaId, storageKey: 'curriculo/ff/ff/sha.pdf' },
      { jobId: `cv-parse-${candidaturaId}` },
    );
    expect(out.key).toBe('curriculo/ff/ff/sha.pdf');
  });

  it('fluxo completo de download + upload + upsert + enqueue', async () => {
    prisma.curriculoProcessado.findUnique.mockResolvedValue(null);
    gupy.baixarCurriculo.mockResolvedValue({
      data: Buffer.from('binary-cv-content'),
      contentType: 'application/pdf',
    });
    storage.putObject.mockImplementation(async (key, { body }) => ({
      bucket: 'triagem',
      key,
      sha256: 'a'.repeat(64),
      etag: 'etag',
      size: body.length,
    }));
    prisma.curriculoProcessado.upsert.mockResolvedValue({});

    const out = await processor.process(
      fakeJob({ candidaturaId, candidatoId, url }),
    );

    expect(gupy.baixarCurriculo).toHaveBeenCalledWith(url);
    expect(storage.putObject).toHaveBeenCalledWith(
      expect.stringMatching(/^curriculo\/[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{64}\.pdf$/),
      expect.objectContaining({
        contentType: 'application/pdf',
        metadata: expect.objectContaining({ candidaturaId, candidatoId }),
      }),
    );
    expect(prisma.curriculoProcessado.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { candidatura_id: candidaturaId },
        create: expect.objectContaining({
          candidatura_id: candidaturaId,
          candidato_id: candidatoId,
          parser_versao: 'pending',
        }),
      }),
    );
    expect(filaParse.add).toHaveBeenCalled();
    expect(out.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejeita CV acima do limite de tamanho', async () => {
    prisma.curriculoProcessado.findUnique.mockResolvedValue(null);
    gupy.baixarCurriculo.mockResolvedValue({
      data: Buffer.alloc(20 * 1024 * 1024), // 20 MB
      contentType: 'application/pdf',
    });

    await expect(
      processor.process(fakeJob({ candidaturaId, candidatoId, url })),
    ).rejects.toThrow(/tamanho máximo/);
    expect(storage.putObject).not.toHaveBeenCalled();
  });

  it('rejeita content-type não suportado', async () => {
    prisma.curriculoProcessado.findUnique.mockResolvedValue(null);
    gupy.baixarCurriculo.mockResolvedValue({
      data: Buffer.from('whatever'),
      contentType: 'image/png',
    });
    await expect(
      processor.process(fakeJob({ candidaturaId, candidatoId, url })),
    ).rejects.toThrow(/Content-Type/);
  });
});
