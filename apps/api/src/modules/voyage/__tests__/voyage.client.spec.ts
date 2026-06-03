import { ConfigService } from '@nestjs/config';
import {
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import nock from 'nock';

import { VoyageClient } from '../voyage.client.js';

function configMock(): ConfigService {
  const map: Record<string, unknown> = {
    VOYAGE_API_KEY: 'pa-test-key-1234567890',
    VOYAGE_API_BASE_URL: 'https://api.voyageai.com',
    VOYAGE_MODEL: 'voyage-3',
    VOYAGE_DIMENSIONS: 4, // pequeno só pra teste
    VOYAGE_TIMEOUT_MS: 5000,
    VOYAGE_RETRY_MAX: 0,
    // RPM alto para o limiter não espaçar as chamadas no teste (default=3 ⇒ ~22s
    // entre lotes, estourando o timeout do embedManyBatched).
    VOYAGE_RATE_LIMIT_RPM: 100000,
    VOYAGE_MAX_CONCURRENT: 10,
  };
  return {
    getOrThrow: <T>(k: string) => map[k] as T,
    get: <T>(k: string) => map[k] as T,
  } as unknown as ConfigService;
}

const HOST = 'https://api.voyageai.com';

describe('VoyageClient', () => {
  let client: VoyageClient;

  beforeEach(() => {
    nock.disableNetConnect();
    client = new VoyageClient(configMock());
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  it('rejeita batch vazio', async () => {
    await expect(client.embed({ textos: [] })).rejects.toThrow(/vazio/);
  });

  it('rejeita texto vazio dentro do batch', async () => {
    await expect(
      client.embed({ textos: ['ok', '   '] }),
    ).rejects.toThrow(/texto\[1\] vazio/);
  });

  it('rejeita batch > 128', async () => {
    const textos = Array.from({ length: 129 }, (_, i) => `t${i}`);
    await expect(client.embed({ textos })).rejects.toThrow(/limite/);
  });

  it('faz POST com Authorization Bearer e retorna vetores na ordem correta', async () => {
    nock(HOST)
      .post('/v1/embeddings', (body) => {
        expect(body.model).toBe('voyage-3');
        expect(body.input).toEqual(['a', 'b']);
        return true;
      })
      .matchHeader('authorization', /^Bearer pa-test-/)
      .reply(200, {
        object: 'list',
        data: [
          { object: 'embedding', embedding: [4, 3, 2, 1], index: 1 },
          { object: 'embedding', embedding: [1, 2, 3, 4], index: 0 },
        ],
        model: 'voyage-3',
        usage: { total_tokens: 42 },
      });

    const out = await client.embed({ textos: ['a', 'b'] });
    expect(out.vetores).toEqual([
      [1, 2, 3, 4],
      [4, 3, 2, 1],
    ]);
    expect(out.usage.total_tokens).toBe(42);
  });

  it('falha alto se a dimensão retornada não bate', async () => {
    nock(HOST)
      .post('/v1/embeddings')
      .reply(200, {
        object: 'list',
        data: [{ object: 'embedding', embedding: [1, 2, 3], index: 0 }],
        model: 'voyage-3',
        usage: { total_tokens: 5 },
      });

    await expect(client.embed({ textos: ['x'] })).rejects.toThrow(
      /Dimensão inesperada/,
    );
  });

  it('mapeia 429 para ServiceUnavailable (job recuperável)', async () => {
    nock(HOST).post('/v1/embeddings').reply(429, { error: 'rate limit' });

    await expect(client.embed({ textos: ['x'] })).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('mapeia erro de schema inesperado para 500', async () => {
    nock(HOST)
      .post('/v1/embeddings')
      .reply(200, { foo: 'bar' }); // resposta inválida

    await expect(client.embed({ textos: ['x'] })).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });

  it('embedManyBatched fatia em 128 e concatena', async () => {
    const textos = Array.from({ length: 130 }, (_, i) => `t${i}`);

    nock(HOST)
      .post('/v1/embeddings')
      .reply(200, {
        object: 'list',
        data: Array.from({ length: 128 }, (_, i) => ({
          object: 'embedding',
          embedding: [0, 0, 0, i],
          index: i,
        })),
        model: 'voyage-3',
        usage: { total_tokens: 1280 },
      })
      .post('/v1/embeddings')
      .reply(200, {
        object: 'list',
        data: [
          { object: 'embedding', embedding: [9, 9, 9, 1], index: 0 },
          { object: 'embedding', embedding: [9, 9, 9, 2], index: 1 },
        ],
        model: 'voyage-3',
        usage: { total_tokens: 20 },
      });

    const out = await client.embedManyBatched(textos);
    expect(out.vetores).toHaveLength(130);
    expect(out.usage.total_tokens).toBe(1300);
  });
});
