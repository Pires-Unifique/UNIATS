import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import nock from 'nock';

import { WahaClient } from '../waha.client.js';

function configMock(): ConfigService {
  const map: Record<string, unknown> = {
    WAHA_BASE_URL: 'http://waha.local',
    WAHA_API_KEY: 'apikey-test-12345',
    WAHA_SESSION: 'default',
    WAHA_TIMEOUT_MS: 5000,
    WAHA_RETRY_MAX: 0,
    WAHA_TYPING_MS: 0, // desliga delay nos testes
  };
  return {
    getOrThrow: <T>(k: string) => map[k] as T,
    get: <T>(k: string) => map[k] as T,
  } as unknown as ConfigService;
}

const HOST = 'http://waha.local';

describe('WahaClient', () => {
  let client: WahaClient;

  beforeEach(() => {
    nock.disableNetConnect();
    client = new WahaClient(configMock());
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  describe('checkNumber', () => {
    it('normaliza telefone E.164 e devolve chatId BR canônico', async () => {
      nock(HOST)
        .get('/api/checkNumberStatus')
        .query({ phone: '5547999998888', session: 'default' })
        .matchHeader('x-api-key', /apikey-/)
        .reply(200, {
          numberExists: true,
          chatId: '5547999998888@c.us',
        });

      const out = await client.checkNumber('+55 (47) 99999-8888');
      expect(out.numberExists).toBe(true);
      expect(out.chatId).toBe('5547999998888@c.us');
    });

    it('rejeita telefone curto/longo', async () => {
      await expect(client.checkNumber('123')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('sendText', () => {
    it('envia POST /api/sendText com session e chatId, devolve messageId', async () => {
      nock(HOST)
        .post('/api/sendText', (body) => {
          expect(body.session).toBe('default');
          expect(body.chatId).toBe('5547999998888@c.us');
          expect(body.text).toContain('Olá');
          expect(body.linkPreview).toBe(false);
          return true;
        })
        .reply(200, { id: { _serialized: 'true_5547@c.us_AAA' } });

      const out = await client.sendText({
        chatId: '5547999998888@c.us',
        texto: 'Olá, mundo',
      });
      expect(out.messageId).toBe('true_5547@c.us_AAA');
    });

    it('rejeita chatId mal formado', async () => {
      await expect(
        client.sendText({ chatId: 'naoehchat' as any, texto: 'x' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('mapeia 429 para ServiceUnavailable (job recuperável)', async () => {
      nock(HOST).post('/api/sendText').reply(429, 'rate limit');
      await expect(
        client.sendText({ chatId: '5547999998888@c.us', texto: 'x' }),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });

    it('mapeia 422 para BadRequest (sem retry)', async () => {
      nock(HOST)
        .post('/api/sendText')
        .reply(422, { message: 'chatId invalido' });
      await expect(
        client.sendText({ chatId: '5547999998888@c.us', texto: 'x' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('sendFile com URL', () => {
    it('rejeita URL HTTP (SSRF guard)', async () => {
      await expect(
        client.sendFile({
          chatId: '5547999998888@c.us',
          arquivo: { url: 'http://example.com/doc.pdf' },
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejeita URL para localhost (SSRF guard)', async () => {
      await expect(
        client.sendFile({
          chatId: '5547999998888@c.us',
          arquivo: { url: 'https://127.0.0.1/secret.pdf' },
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('aceita HTTPS público e envia com filename', async () => {
      nock(HOST)
        .post('/api/sendFile', (body) => {
          expect(body.file.url).toBe('https://example.com/proposta.pdf');
          expect(body.file.filename).toBe('proposta.pdf');
          expect(body.caption).toBe('Sua proposta');
          return true;
        })
        .reply(200, { id: 'true_xxx' });

      const out = await client.sendFile({
        chatId: '5547999998888@c.us',
        arquivo: { url: 'https://example.com/proposta.pdf' },
        nomeArquivo: 'proposta.pdf',
        legenda: 'Sua proposta',
      });
      expect(out.messageId).toBe('true_xxx');
    });
  });
});
