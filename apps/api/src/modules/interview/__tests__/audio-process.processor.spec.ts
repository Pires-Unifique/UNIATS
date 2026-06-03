import { ConfigService } from '@nestjs/config';
import type { Job, Queue } from 'bullmq';

import { AudioProcessProcessor } from '../processors/audio-process.processor.js';
import { CryptoService } from '../../crypto/crypto.service.js';
import { MeetStreamClient } from '../../meetstream/meetstream.client.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { StorageService } from '../../storage/storage.service.js';

function fakeJob(data: unknown, id = '1'): Job<unknown> {
  return { id, data, attemptsMade: 0 } as Job<unknown>;
}

function configMock(): ConfigService {
  const map: Record<string, unknown> = {
    RETENCAO_AUDIO_DIAS: '90',
    AUDIO_MAX_BYTES: `${10 * 1024 * 1024}`,
  };
  return {
    get: <T>(k: string) => map[k] as T,
    getOrThrow: <T>(k: string) => map[k] as T,
  } as unknown as ConfigService;
}

describe('AudioProcessProcessor', () => {
  let meetstream: jest.Mocked<MeetStreamClient>;
  let storage: jest.Mocked<StorageService>;
  let crypto: jest.Mocked<CryptoService>;
  let prisma: any;
  let filaTranscricao: jest.Mocked<Queue>;
  let processor: AudioProcessProcessor;

  const entrevistaId = '00000000-0000-4000-8000-000000000001';
  const botId = 'bot-xyz';

  beforeEach(() => {
    meetstream = {
      obterGravacao: jest.fn(),
      baixarAudio: jest.fn(),
    } as unknown as jest.Mocked<MeetStreamClient>;

    storage = {
      buildKey: jest.fn(
        ({ kind, sha256, extension }) =>
          `${kind}/${sha256.slice(0, 2)}/${sha256.slice(2, 4)}/${sha256}.${extension}`,
      ),
      putObject: jest.fn().mockResolvedValue({
        bucket: 'triagem',
        key: '',
        sha256: 'f'.repeat(64),
        size: 100,
        etag: 'e',
      }),
    } as unknown as jest.Mocked<StorageService>;

    crypto = {
      encrypt: jest.fn().mockImplementation((b: Buffer) => ({
        bytes: Buffer.concat([Buffer.alloc(28), b]), // simula iv+tag+ct
        ciphertextLen: b.length,
      })),
    } as unknown as jest.Mocked<CryptoService>;

    prisma = {
      entrevista: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
    };

    filaTranscricao = { add: jest.fn() } as unknown as jest.Mocked<Queue>;

    processor = new AudioProcessProcessor(
      meetstream,
      storage,
      crypto,
      prisma as PrismaService,
      configMock(),
      filaTranscricao,
    );
  });

  it('rejeita payload inválido', async () => {
    await expect(
      processor.process(fakeJob({ entrevistaId: 'x' })),
    ).rejects.toThrow(/Payload inválido/);
  });

  it('idempotência: se entrevista já tem audio_url + sha256, só re-enfileira transcrição', async () => {
    prisma.entrevista.findUnique.mockResolvedValue({
      id: entrevistaId,
      audio_url: 'audio/aa/bb/sha.enc',
      audio_sha256: 'a'.repeat(64),
    });
    const out = await processor.process(
      fakeJob({ entrevistaId, botId }),
    );
    expect(meetstream.obterGravacao).not.toHaveBeenCalled();
    expect(out.storageKey).toBe('audio/aa/bb/sha.enc');
    expect(filaTranscricao.add).toHaveBeenCalled();
  });

  it('falha cedo se MeetStream ainda não tem gravação', async () => {
    prisma.entrevista.findUnique.mockResolvedValue({
      id: entrevistaId,
      audio_url: null,
      audio_sha256: null,
    });
    meetstream.obterGravacao.mockResolvedValue(null);
    await expect(
      processor.process(fakeJob({ entrevistaId, botId })),
    ).rejects.toThrow(/não disponibilizou/);
  });

  it('rejeita content-type não suportado', async () => {
    prisma.entrevista.findUnique.mockResolvedValue({
      id: entrevistaId,
      audio_url: null,
    });
    meetstream.obterGravacao.mockResolvedValue({
      url: 'https://cdn.example.com/x.txt',
    });
    meetstream.baixarAudio.mockResolvedValue({
      data: Buffer.from('not-audio'),
      contentType: 'text/plain',
    });
    await expect(
      processor.process(fakeJob({ entrevistaId, botId })),
    ).rejects.toThrow(/Content-Type/);
  });

  it('rejeita áudio acima do limite', async () => {
    prisma.entrevista.findUnique.mockResolvedValue({
      id: entrevistaId,
      audio_url: null,
    });
    meetstream.obterGravacao.mockResolvedValue({
      url: 'https://cdn.example.com/x.mp3',
    });
    meetstream.baixarAudio.mockResolvedValue({
      data: Buffer.alloc(11 * 1024 * 1024), // > 10MB do config
      contentType: 'audio/mpeg',
    });
    await expect(
      processor.process(fakeJob({ entrevistaId, botId })),
    ).rejects.toThrow(/tamanho máximo/);
  });

  it('fluxo completo: download → encrypt com AAD → storage → update DB → enfileira', async () => {
    prisma.entrevista.findUnique.mockResolvedValue({
      id: entrevistaId,
      audio_url: null,
      audio_sha256: null,
    });
    meetstream.obterGravacao.mockResolvedValue({
      url: 'https://cdn.example.com/audio.mp3',
      duracaoMs: 60_000,
    });
    const audioBuf = Buffer.from('audio-bytes-aqui');
    meetstream.baixarAudio.mockResolvedValue({
      data: audioBuf,
      contentType: 'audio/mpeg',
    });

    const out = await processor.process(fakeJob({ entrevistaId, botId }));

    // AAD deve ser bytes do entrevistaId
    expect(crypto.encrypt).toHaveBeenCalledWith(
      audioBuf,
      Buffer.from(entrevistaId, 'utf8'),
    );

    // Storage com extension=enc + metadata
    expect(storage.putObject).toHaveBeenCalledWith(
      expect.stringMatching(/\.enc$/),
      expect.objectContaining({
        contentType: 'application/octet-stream',
        metadata: expect.objectContaining({
          entrevistaId,
          algoritmo: 'aes-256-gcm',
          mimeOriginal: 'audio/mpeg',
        }),
      }),
    );

    // Update DB com status FINALIZADA + audio_expira_em ≈ now + 90d
    expect(prisma.entrevista.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: entrevistaId },
        data: expect.objectContaining({
          status: 'FINALIZADA',
          bot_status: 'ended',
        }),
      }),
    );
    const updateArgs = prisma.entrevista.update.mock.calls[0][0];
    const expira = updateArgs.data.audio_expira_em as Date;
    const dias = (expira.getTime() - Date.now()) / 86_400_000;
    expect(dias).toBeGreaterThan(89);
    expect(dias).toBeLessThan(91);

    // Enfileira transcrição
    expect(filaTranscricao.add).toHaveBeenCalledWith(
      'transcrever',
      expect.objectContaining({ entrevistaId }),
      expect.objectContaining({ jobId: `transcricao-${entrevistaId}` }),
    );

    expect(out.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});
