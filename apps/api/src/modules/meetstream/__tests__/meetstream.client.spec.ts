import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import nock from 'nock';

import { MeetStreamClient } from '../meetstream.client.js';

function configMock(): ConfigService {
  const map: Record<string, unknown> = {
    MEETSTREAM_API_KEY: 'tok-test-123456',
    MEETSTREAM_BASE_URL: 'https://api.meetstream.test',
    MEETSTREAM_TIMEOUT_MS: 5000,
    MEETSTREAM_RETRY_MAX: 0,
  };
  return {
    getOrThrow: <T>(k: string) => map[k] as T,
    get: <T>(k: string) => map[k] as T,
  } as unknown as ConfigService;
}

const HOST = 'https://api.meetstream.test';

describe('MeetStreamClient', () => {
  let client: MeetStreamClient;

  beforeEach(() => {
    nock.disableNetConnect();
    client = new MeetStreamClient(configMock());
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  describe('criarBot', () => {
    it('rejeita meetUrl não-HTTPS', async () => {
      await expect(
        client.criarBot({
          meetUrl: 'http://meet.google.com/abc',
          webhookUrl: 'https://api.example.com/webhooks/meetstream',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejeita meetUrl de host não suportado', async () => {
      await expect(
        client.criarBot({
          meetUrl: 'https://malicious.example.com/abc',
          webhookUrl: 'https://api.example.com/webhooks/meetstream',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('aceita Google Meet e envia POST com Authorization Token', async () => {
      nock(HOST)
        .post('/api/v1/bots/create_bot', (body) => {
          expect(body.meeting_link).toMatch(/^https:\/\/meet\.google\.com/);
          // callback_url (não webhook_url) é o que registra o webhook de eventos.
          expect(body.callback_url).toBe(
            'https://api.example.com/webhooks/meetstream',
          );
          // Transcrição configurada via recording_config.transcript.provider.
          expect(body.recording_config?.transcript?.provider).toBeDefined();
          expect(body.audio_required).toBeUndefined();
          expect(body.transcript_required).toBeUndefined();
          return true;
        })
        .matchHeader('authorization', /^Token tok-/)
        .reply(200, { bot_id: 'bot-abc', status: 'created' });

      const out = await client.criarBot({
        meetUrl: 'https://meet.google.com/xxx-yyy-zzz',
        webhookUrl: 'https://api.example.com/webhooks/meetstream',
      });
      expect(out.botId).toBe('bot-abc');
    });

    it('mapeia 422 para BadRequest sem retry', async () => {
      nock(HOST)
        .post('/api/v1/bots/create_bot')
        .reply(422, { message: 'meeting_link inválido' });
      await expect(
        client.criarBot({
          meetUrl: 'https://meet.google.com/x',
          webhookUrl: 'https://api.example.com/webhooks/meetstream',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('mapeia 503 para ServiceUnavailable (job recuperável)', async () => {
      nock(HOST).post('/api/v1/bots/create_bot').reply(503, 'down');
      await expect(
        client.criarBot({
          meetUrl: 'https://meet.google.com/x',
          webhookUrl: 'https://api.example.com/webhooks/meetstream',
        }),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
  });

  describe('obterGravacao', () => {
    it('devolve null em 404', async () => {
      nock(HOST).get('/api/v1/bots/bot-1/get_audio').reply(404);
      const out = await client.obterGravacao('bot-1');
      expect(out).toBeNull();
    });

    it('devolve URL e metadata quando disponível', async () => {
      nock(HOST)
        .get('/api/v1/bots/bot-1/get_audio')
        .reply(200, {
          audio_url: 'https://cdn.example.com/audio.mp3',
          duration_ms: 1800_000,
          mime_type: 'audio/mpeg',
        });
      const out = await client.obterGravacao('bot-1');
      expect(out?.url).toBe('https://cdn.example.com/audio.mp3');
      expect(out?.duracaoMs).toBe(1800_000);
    });
  });

  describe('baixarAudio', () => {
    it('rejeita URL não-HTTPS', async () => {
      await expect(
        client.baixarAudio('http://example.com/x.mp3'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('obterTranscript', () => {
    it('devolve null quando nenhuma transcrição está Success', async () => {
      nock(HOST)
        .get('/api/v1/bots/bot-1/transcriptions')
        .reply(200, { bot_id: 'bot-1', transcriptions: [{ status: 'Processing' }] });
      const out = await client.obterTranscript('bot-1');
      expect(out).toBeNull();
    });

    it('baixa a URL pré-assinada e normaliza segmentos', async () => {
      nock(HOST)
        .get('/api/v1/bots/bot-1/transcriptions')
        .reply(200, {
          bot_id: 'bot-1',
          transcriptions: [
            {
              status: 'Success',
              provider: 'recallai_streaming',
              download_urls: {
                processed_transcript:
                  'https://s3.example.com/t.json?sig=abc',
              },
            },
          ],
        });
      nock('https://s3.example.com')
        .get('/t.json')
        .query(true)
        .reply(200, [
          { speaker: 'A', text: 'Olá', start: 1, end: 2 },
          { speaker: 'B', text: 'Tudo bem?', start: 2, end: 3 },
        ]);
      const out = await client.obterTranscript('bot-1');
      expect(out?.segmentos).toHaveLength(2);
      expect(out?.texto).toContain('Olá');
      expect(out?.segmentos[0].falante).toBe('A');
      expect(out?.segmentos[0].inicio_ms).toBe(1000); // 1s → ms
    });
  });
});
