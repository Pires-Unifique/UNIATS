import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance, isAxiosError } from 'axios';
import axiosRetry from 'axios-retry';
import { z } from 'zod';

/**
 * Cliente do AssemblyAI (https://www.assemblyai.com/docs).
 *
 * Fluxo:
 *  1. POST /v2/upload com bytes do áudio → devolve `upload_url` temporária.
 *  2. POST /v2/transcript com `audio_url` (a upload_url do passo anterior) +
 *     `speaker_labels: true`, `sentiment_analysis: true`, `language_code: pt`,
 *     `webhook_url: <nosso endpoint>`, `webhook_auth_header_name/value: <secret>`.
 *  3. AssemblyAI processa e bate em /webhooks/assemblyai com {transcript_id, status}.
 *  4. GET /v2/transcript/{id} → texto completo + utterances + sentiment.
 *
 * Auth: header `Authorization: <api_key>` (sem prefixo Bearer).
 */

const UploadResponseSchema = z.object({
  upload_url: z.string().url(),
});

const CreateTranscriptResponseSchema = z
  .object({
    id: z.string(),
    status: z.enum(['queued', 'processing', 'completed', 'error']),
  })
  .passthrough();

const UtteranceSchema = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  speaker: z.string().optional(),
  text: z.string(),
  confidence: z.number().min(0).max(1).optional(),
});

const SentimentResultSchema = z.object({
  text: z.string(),
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  sentiment: z.enum(['POSITIVE', 'NEUTRAL', 'NEGATIVE']),
  confidence: z.number().min(0).max(1).optional(),
  speaker: z.string().optional(),
});

const TranscriptDetalheSchema = z
  .object({
    id: z.string(),
    status: z.enum(['queued', 'processing', 'completed', 'error']),
    error: z.string().nullable().optional(),
    language_code: z.string().optional(),
    text: z.string().nullable().optional(),
    confidence: z.number().min(0).max(1).optional(),
    audio_duration: z.number().int().nonnegative().optional(),
    utterances: z.array(UtteranceSchema).nullable().optional(),
    sentiment_analysis_results: z
      .array(SentimentResultSchema)
      .nullable()
      .optional(),
  })
  .passthrough();

export type TranscricaoDetalhe = z.infer<typeof TranscriptDetalheSchema>;

@Injectable()
export class AssemblyAIClient {
  private readonly logger = new Logger(AssemblyAIClient.name);
  private readonly http: AxiosInstance;
  private readonly defaultLanguage: string;
  private readonly speakerLabels: boolean;
  private readonly sentimentAnalysis: boolean;
  private readonly webhookSecret?: string;

  constructor(private readonly config: ConfigService) {
    // Opcional: sem a key, o client é construído mas as chamadas falham em runtime
    // (AssemblyAI não é usado até a transcrição ser ligada). Não derruba o boot.
    const apiKey = this.config.get<string>('ASSEMBLYAI_API_KEY') ?? '';
    this.defaultLanguage =
      this.config.get<string>('ASSEMBLYAI_LANGUAGE_CODE') ?? 'pt';
    this.speakerLabels = Boolean(
      this.config.get<string>('ASSEMBLYAI_SPEAKER_LABELS') === 'true',
    );
    this.sentimentAnalysis = Boolean(
      this.config.get<string>('ASSEMBLYAI_SENTIMENT_ANALYSIS') === 'true',
    );
    this.webhookSecret = this.config.get<string>('ASSEMBLYAI_WEBHOOK_SECRET');

    this.http = axios.create({
      baseURL: 'https://api.assemblyai.com',
      timeout: this.config.getOrThrow<number>('ASSEMBLYAI_TIMEOUT_MS'),
      headers: {
        Authorization: apiKey,
        Accept: 'application/json',
      },
    });

    axiosRetry(this.http, {
      retries: this.config.getOrThrow<number>('ASSEMBLYAI_RETRY_MAX'),
      retryDelay: axiosRetry.exponentialDelay,
      retryCondition: (error) => {
        const status = error.response?.status;
        if (status === 400 || status === 422) return false;
        return (
          axiosRetry.isNetworkOrIdempotentRequestError(error) ||
          status === 429 ||
          (status !== undefined && status >= 500)
        );
      },
    });
  }

  /**
   * Upload do áudio (bytes em octet-stream). A URL retornada é privada para o AssemblyAI
   * e expira em ~24h. NÃO compartilhar com terceiros.
   */
  async uploadAudio(
    buffer: Buffer,
    mimeType = 'application/octet-stream',
  ): Promise<string> {
    if (!buffer?.length) {
      throw new BadRequestException('Buffer de áudio vazio.');
    }
    try {
      const resp = await this.http.post('/v2/upload', buffer, {
        headers: { 'Content-Type': mimeType },
        // mande bytes brutos — não JSON
        transformRequest: [(d) => d],
        maxContentLength: 500 * 1024 * 1024,
        maxBodyLength: 500 * 1024 * 1024,
      });
      const parsed = UploadResponseSchema.parse(resp.data);
      return parsed.upload_url;
    } catch (err) {
      throw this.normalizarErro(err, 'uploadAudio');
    }
  }

  /**
   * Cria um job de transcrição. Webhook URL deve ser HTTPS pública (ngrok em dev).
   */
  async criarTranscricao(args: {
    audioUrl: string;
    webhookUrl: string;
    /** ID interno da entrevista — vai no header de auth do webhook. */
    entrevistaId?: string;
  }): Promise<{ id: string; status: string }> {
    if (!args.audioUrl.startsWith('https://')) {
      throw new BadRequestException(
        'audioUrl deve ser HTTPS (upload_url do AssemblyAI ou URL pública).',
      );
    }
    if (!args.webhookUrl.startsWith('https://')) {
      throw new BadRequestException('webhookUrl deve ser HTTPS.');
    }

    const body: Record<string, unknown> = {
      audio_url: args.audioUrl,
      language_code: this.defaultLanguage,
      speaker_labels: this.speakerLabels,
      sentiment_analysis: this.sentimentAnalysis,
      webhook_url: args.webhookUrl,
      // Use Universal-2 (default em 2025). Mantemos explícito para garantir.
      speech_model: 'universal',
    };

    if (this.webhookSecret) {
      body.webhook_auth_header_name = 'X-Webhook-Secret';
      body.webhook_auth_header_value = this.webhookSecret;
    }

    try {
      const resp = await this.http.post('/v2/transcript', body, {
        headers: { 'Content-Type': 'application/json' },
      });
      const parsed = CreateTranscriptResponseSchema.parse(resp.data);
      this.logger.log(
        `Transcrição AssemblyAI enfileirada: id=${parsed.id} status=${parsed.status}`,
      );
      return { id: parsed.id, status: parsed.status };
    } catch (err) {
      throw this.normalizarErro(err, 'criarTranscricao');
    }
  }

  async obterTranscricao(transcriptId: string): Promise<TranscricaoDetalhe> {
    try {
      const resp = await this.http.get(
        `/v2/transcript/${encodeURIComponent(transcriptId)}`,
      );
      return TranscriptDetalheSchema.parse(resp.data);
    } catch (err) {
      throw this.normalizarErro(err, 'obterTranscricao');
    }
  }

  /** Permite ao webhook controller validar o header secret. */
  validarWebhookSecret(headerValue: string | undefined): boolean {
    if (!this.webhookSecret) return true; // sem secret configurado → liberado em dev
    if (!headerValue) return false;
    // comparação constant-time
    const a = Buffer.from(this.webhookSecret);
    const b = Buffer.from(headerValue);
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0;
  }

  private normalizarErro(err: unknown, op: string): Error {
    if (isAxiosError(err)) {
      const status = err.response?.status;
      this.logger.error(
        `AssemblyAI ${op} status=${status} body=${JSON.stringify(err.response?.data ?? err.message).slice(0, 400)}`,
      );
      if (status === 400 || status === 422) {
        return new BadRequestException(
          `AssemblyAI recusou payload em ${op}.`,
        );
      }
      if (status === 429 || (status && status >= 500)) {
        return new ServiceUnavailableException(
          `AssemblyAI indisponível (${status}) — job será re-tentado.`,
        );
      }
    } else {
      this.logger.error(`AssemblyAI ${op} erro: ${(err as Error).message}`);
    }
    return new InternalServerErrorException(`Falha em AssemblyAI ${op}.`);
  }
}
