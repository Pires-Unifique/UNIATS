import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import nock from 'nock';

import { AssemblyAIClient } from '../assemblyai.client.js';

function configMock(): ConfigService {
  const map: Record<string, unknown> = {
    ASSEMBLYAI_API_KEY: 'aa-test-key-1234567890',
    ASSEMBLYAI_LANGUAGE_CODE: 'pt',
    ASSEMBLYAI_SPEAKER_LABELS: 'true',
    ASSEMBLYAI_SENTIMENT_ANALYSIS: 'true',
    ASSEMBLYAI_TIMEOUT_MS: 5000,
    ASSEMBLYAI_RETRY_MAX: 0,
    ASSEMBLYAI_WEBHOOK_SECRET: 'secret-webhook-token-x',
  };
  return {
    getOrThrow: <T>(k: string) => map[k] as T,
    get: <T>(k: string) => map[k] as T,
  } as unknown as ConfigService;
}

const HOST = 'https://api.assemblyai.com';

describe('AssemblyAIClient', () => {
  let client: AssemblyAIClient;

  beforeEach(() => {
    nock.disableNetConnect();
    client = new AssemblyAIClient(configMock());
  });

  afterEach(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  describe('uploadAudio', () => {
    it('rejeita buffer vazio', async () => {
      await expect(client.uploadAudio(Buffer.alloc(0))).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('envia POST /v2/upload com authorization e devolve upload_url', async () => {
      nock(HOST)
        .post('/v2/upload', (body) => Buffer.isBuffer(body) || typeof body === 'string')
        .matchHeader('authorization', /^aa-test-/)
        .reply(200, { upload_url: 'https://cdn.assemblyai.com/uploads/abc' });

      const out = await client.uploadAudio(
        Buffer.from('fake-audio-bytes'),
        'audio/mpeg',
      );
      expect(out).toBe('https://cdn.assemblyai.com/uploads/abc');
    });
  });

  describe('criarTranscricao', () => {
    it('envia POST /v2/transcript com speaker_labels + sentiment + webhook + secret', async () => {
      nock(HOST)
        .post('/v2/transcript', (body) => {
          expect(body.audio_url).toMatch(/^https:\/\//);
          expect(body.language_code).toBe('pt');
          expect(body.speaker_labels).toBe(true);
          expect(body.sentiment_analysis).toBe(true);
          expect(body.webhook_url).toMatch(/^https:\/\//);
          expect(body.webhook_auth_header_name).toBe('X-Webhook-Secret');
          expect(body.webhook_auth_header_value).toBe(
            'secret-webhook-token-x',
          );
          expect(body.speech_model).toBe('universal');
          return true;
        })
        .reply(200, { id: 'tx-1', status: 'queued' });

      const out = await client.criarTranscricao({
        audioUrl: 'https://cdn.assemblyai.com/uploads/abc',
        webhookUrl: 'https://api.example.com/webhooks/assemblyai',
      });
      expect(out.id).toBe('tx-1');
      expect(out.status).toBe('queued');
    });

    it('rejeita audioUrl não-HTTPS', async () => {
      await expect(
        client.criarTranscricao({
          audioUrl: 'http://example.com/x',
          webhookUrl: 'https://api.example.com/webhooks/assemblyai',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('mapeia 429 para ServiceUnavailable', async () => {
      nock(HOST).post('/v2/transcript').reply(429, { error: 'rate limit' });
      await expect(
        client.criarTranscricao({
          audioUrl: 'https://cdn.assemblyai.com/uploads/abc',
          webhookUrl: 'https://api.example.com/webhooks/assemblyai',
        }),
      ).rejects.toBeInstanceOf(ServiceUnavailableException);
    });
  });

  describe('obterTranscricao', () => {
    it('valida shape e devolve com utterances/sentiment', async () => {
      nock(HOST)
        .get('/v2/transcript/tx-1')
        .reply(200, {
          id: 'tx-1',
          status: 'completed',
          language_code: 'pt',
          text: 'Olá, tudo bem?',
          confidence: 0.97,
          audio_duration: 1800,
          utterances: [
            {
              start: 0,
              end: 1500,
              speaker: 'A',
              text: 'Olá, tudo bem?',
              confidence: 0.95,
            },
          ],
          sentiment_analysis_results: [
            {
              text: 'Olá, tudo bem?',
              start: 0,
              end: 1500,
              sentiment: 'POSITIVE',
              confidence: 0.9,
              speaker: 'A',
            },
          ],
        });
      const out = await client.obterTranscricao('tx-1');
      expect(out.status).toBe('completed');
      expect(out.utterances).toHaveLength(1);
      expect(out.sentiment_analysis_results?.[0].sentiment).toBe('POSITIVE');
    });
  });

  describe('validarWebhookSecret', () => {
    it('aceita header igual ao configurado', () => {
      expect(client.validarWebhookSecret('secret-webhook-token-x')).toBe(true);
    });
    it('rejeita header diferente', () => {
      expect(client.validarWebhookSecret('outro')).toBe(false);
    });
    it('rejeita header ausente', () => {
      expect(client.validarWebhookSecret(undefined)).toBe(false);
    });
  });
});
