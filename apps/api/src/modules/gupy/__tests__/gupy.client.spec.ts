import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import nock from 'nock';

import { ConfigService } from '@nestjs/config';

import { GupyClient, GupyApiError } from '../gupy.client.js';

import {
  vagaFakeJson,
  candidaturaFakeJson,
  respostaPaginadaVagas,
  respostaPaginadaCandidaturas,
} from './fixtures/gupy.fixtures.js';

const BASE = 'https://api.gupy.io/api/v1';

function montarConfig(overrides: Record<string, unknown> = {}): ConfigService {
  const env: Record<string, unknown> = {
    GUPY_API_BASE_URL: BASE,
    GUPY_API_TOKEN: 'token-de-testes-fake',
    GUPY_TIMEOUT_MS: 5_000,
    GUPY_RATE_LIMIT_RPS: 100, // alto para não atrasar testes
    GUPY_RETRY_MAX: 2,
    GUPY_RETRY_BASE_MS: 10, // backoff curto para o teste
    ...overrides,
  };
  return {
    get: (key: string) => env[key],
    getOrThrow: (key: string) => {
      if (env[key] === undefined) throw new Error(`missing ${key}`);
      return env[key];
    },
  } as unknown as ConfigService;
}

describe('GupyClient', () => {
  beforeAll(() => {
    nock.disableNetConnect();
  });
  afterAll(() => {
    nock.enableNetConnect();
  });
  afterEach(() => {
    nock.cleanAll();
  });

  describe('listarVagas', () => {
    it('faz GET com Bearer e valida payload pelo schema', async () => {
      const scope = nock(BASE, {
        reqheaders: {
          authorization: 'Bearer token-de-testes-fake',
          accept: 'application/json',
        },
      })
        .get('/jobs')
        .query(true)
        .reply(200, respostaPaginadaVagas());

      const client = new GupyClient(montarConfig());
      const vagas = await client.listarVagas();

      expect(vagas).toHaveLength(1);
      expect(vagas[0].id).toBe(BigInt(vagaFakeJson.id));
      expect(vagas[0].name).toBe(vagaFakeJson.name);
      scope.done();
    });

    it('lança GupyApiError quando o payload não bate com o schema', async () => {
      nock(BASE)
        .get('/jobs')
        .query(true)
        .reply(200, { foo: 'bar' }); // sem `data`

      const client = new GupyClient(montarConfig());
      await expect(client.listarVagas()).rejects.toBeInstanceOf(GupyApiError);
    });
  });

  describe('retries', () => {
    it('faz retry em 503 e sucede na segunda tentativa', async () => {
      nock(BASE)
        .get('/jobs')
        .query(true)
        .reply(503, 'overloaded')
        .get('/jobs')
        .query(true)
        .reply(200, respostaPaginadaVagas());

      const client = new GupyClient(montarConfig());
      const vagas = await client.listarVagas();
      expect(vagas).toHaveLength(1);
    });

    it('respeita Retry-After em 429', async () => {
      const inicio = Date.now();
      nock(BASE)
        .get('/jobs')
        .query(true)
        .reply(429, 'slow down', { 'retry-after': '1' })
        .get('/jobs')
        .query(true)
        .reply(200, respostaPaginadaVagas());

      const client = new GupyClient(montarConfig());
      await client.listarVagas();
      const decorrido = Date.now() - inicio;
      // Aceita margem de jitter — mínimo ≈ 900ms.
      expect(decorrido).toBeGreaterThanOrEqual(900);
    }, 10_000);

    it('desiste após esgotar retries em 5xx', async () => {
      nock(BASE)
        .get('/jobs')
        .query(true)
        .times(3) // tentativa inicial + 2 retries
        .reply(500, 'boom');

      const client = new GupyClient(montarConfig({ GUPY_RETRY_MAX: 2 }));
      await expect(client.listarVagas()).rejects.toBeInstanceOf(GupyApiError);
    });

    it('NÃO faz retry em 4xx (exceto 429)', async () => {
      const scope = nock(BASE)
        .get('/jobs')
        .query(true)
        .reply(404, 'not found');

      const client = new GupyClient(montarConfig());
      await expect(client.listarVagas()).rejects.toBeInstanceOf(GupyApiError);
      expect(scope.isDone()).toBe(true); // chamou apenas uma vez
    });
  });

  describe('iterarVagas', () => {
    it('itera por múltiplas páginas até o resultado vir incompleto', async () => {
      const perPage = 2;
      const pagina1 = {
        results: [
          { ...vagaFakeJson, id: 1, name: 'A' },
          { ...vagaFakeJson, id: 2, name: 'B' },
        ],
        totalResults: 3,
        page: 1,
        totalPages: 2,
      };
      const pagina2 = {
        results: [{ ...vagaFakeJson, id: 3, name: 'C' }],
        totalResults: 3,
        page: 2,
        totalPages: 2,
      };

      nock(BASE)
        .get('/jobs')
        .query((q) => q.page === '1' && q.perPage === '2')
        .reply(200, pagina1)
        .get('/jobs')
        .query((q) => q.page === '2' && q.perPage === '2')
        .reply(200, pagina2);

      const client = new GupyClient(montarConfig());
      const colhidas: bigint[] = [];
      for await (const v of client.iterarVagas({ perPage })) {
        colhidas.push(v.id);
      }
      expect(colhidas).toEqual([BigInt(1), BigInt(2), BigInt(3)]);
    });
  });

  describe('listarCandidaturasDaVaga', () => {
    it('compõe o path com jobId', async () => {
      nock(BASE)
        .get('/jobs/987654/applications')
        .query(true)
        .reply(200, respostaPaginadaCandidaturas());

      const client = new GupyClient(montarConfig());
      const cands = await client.listarCandidaturasDaVaga({
        jobId: BigInt(987654),
      });
      expect(cands).toHaveLength(1);
      expect(cands[0].id).toBe(BigInt(candidaturaFakeJson.id));
    });
  });

  describe('obterVaga / obterCandidatura', () => {
    it('GET /jobs/:id', async () => {
      nock(BASE).get('/jobs/987654').reply(200, vagaFakeJson);
      const client = new GupyClient(montarConfig());
      const v = await client.obterVaga(BigInt(987654));
      expect(v.id).toBe(BigInt(987654));
    });

    it('GET /companies/applications/:id', async () => {
      nock(BASE)
        .get('/companies/applications/5544332211')
        .reply(200, candidaturaFakeJson);
      const client = new GupyClient(montarConfig());
      const c = await client.obterCandidatura(BigInt(5544332211));
      expect(c.id).toBe(BigInt(5544332211));
      expect(c.jobId).toBe(BigInt(987654));
    });
  });

  describe('listarEtapasDaVaga', () => {
    it('GET /jobs/:id/steps e devolve as etapas', async () => {
      const scope = nock(BASE)
        .get('/jobs/987654/steps')
        .query(true)
        .reply(200, {
          results: [
            { id: 100, name: 'Triagem', type: 'online' },
            { id: 200, name: 'Entrevista', type: 'offline' },
          ],
          totalResults: 2,
          page: 1,
          totalPages: 1,
        });

      const client = new GupyClient(montarConfig());
      const etapas = await client.listarEtapasDaVaga({ jobId: BigInt(987654) });

      expect(etapas).toHaveLength(2);
      expect(etapas[0].id).toBe(BigInt(100));
      expect(etapas[1].name).toBe('Entrevista');
      scope.done();
    });
  });

  describe('moverCandidatura', () => {
    it('PATCH /jobs/:jobId/applications/:applicationId com currentStepId (bigint → number)', async () => {
      let bodyRecebido: unknown;
      const scope = nock(BASE)
        .patch('/jobs/987654/applications/5544332211', (body) => {
          bodyRecebido = body;
          return true;
        })
        .reply(200);

      const client = new GupyClient(montarConfig());
      await client.moverCandidatura({
        jobId: BigInt(987654),
        applicationId: BigInt(5544332211),
        currentStepId: BigInt(200),
      });

      expect(bodyRecebido).toEqual({ currentStepId: 200 });
      scope.done();
    });

    it('envia status e motivo de reprovação (notas truncadas em 255)', async () => {
      let bodyRecebido: any;
      const notaLonga = 'x'.repeat(300);
      const scope = nock(BASE)
        .patch('/jobs/987654/applications/5544332211', (body) => {
          bodyRecebido = body;
          return true;
        })
        .reply(200);

      const client = new GupyClient(montarConfig());
      await client.moverCandidatura({
        jobId: BigInt(987654),
        applicationId: BigInt(5544332211),
        status: 'reproved',
        disapprovalReason: 'insufficient_knowledge',
        disapprovalReasonNotes: notaLonga,
      });

      expect(bodyRecebido.status).toBe('reproved');
      expect(bodyRecebido.disapprovalReason).toBe('insufficient_knowledge');
      expect(bodyRecebido.disapprovalReasonNotes).toHaveLength(255);
      scope.done();
    });

    it('rejeita quando nem currentStepId nem status são informados', async () => {
      const client = new GupyClient(montarConfig());
      await expect(
        client.moverCandidatura({
          jobId: BigInt(987654),
          applicationId: BigInt(5544332211),
        }),
      ).rejects.toBeInstanceOf(GupyApiError);
    });

    it('rejeita status inválido sem chamar a API', async () => {
      const client = new GupyClient(montarConfig());
      await expect(
        client.moverCandidatura({
          jobId: BigInt(987654),
          applicationId: BigInt(5544332211),
          status: 'aprovado' as never,
        }),
      ).rejects.toBeInstanceOf(GupyApiError);
    });

    it('propaga erro tipado em 404', async () => {
      nock(BASE)
        .patch('/jobs/987654/applications/999')
        .reply(404, 'not found');

      const client = new GupyClient(montarConfig());
      await expect(
        client.moverCandidatura({
          jobId: BigInt(987654),
          applicationId: BigInt(999),
          currentStepId: 100,
        }),
      ).rejects.toBeInstanceOf(GupyApiError);
    });
  });

  describe('baixarCurriculo — defesa SSRF', () => {
    it('rejeita URL não-HTTPS', async () => {
      const client = new GupyClient(montarConfig());
      await expect(client.baixarCurriculo('http://evil/cv.pdf')).rejects.toBeInstanceOf(
        GupyApiError,
      );
      await expect(client.baixarCurriculo('file:///etc/passwd')).rejects.toBeInstanceOf(
        GupyApiError,
      );
      await expect(client.baixarCurriculo('ftp://x/y')).rejects.toBeInstanceOf(
        GupyApiError,
      );
    });

    it('faz download em HTTPS sem enviar Authorization', async () => {
      const scope = nock('https://cv.example.com', {
        // Bearer não deve ser enviado para URLs pré-assinadas: o client
        // sobrescreve o header com string vazia (não remove, para não reexpor
        // o token default). Garantimos apenas que o token NÃO foi enviado.
        reqheaders: {
          authorization: (val) => !val || !val.includes('token-de-testes-fake'),
        },
      })
        .get('/r.pdf')
        .reply(200, Buffer.from('PDFCONTENT'), {
          'content-type': 'application/pdf',
        });

      const client = new GupyClient(montarConfig());
      const r = await client.baixarCurriculo('https://cv.example.com/r.pdf');
      expect(r.contentType).toBe('application/pdf');
      expect(r.data.toString('utf8')).toBe('PDFCONTENT');
      scope.done();
    });
  });
});
