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
 * Cliente HTTP do MeetStream (https://meetstream.ai).
 *
 * MeetStream provê bots que entram em chamadas Google Meet / Zoom / Teams,
 * gravam áudio e expõem o arquivo via URL temporária + webhooks de ciclo de vida.
 *
 * A API exige header `Authorization: Token <key>` (compatível com seu Postman/docs).
 * Endpoints relevantes (subject a verificação no CSM):
 *   POST /api/v1/bots/create_bot      → cria bot e o envia para a reunião
 *   GET  /api/v1/bots/{id}             → status atual
 *   POST /api/v1/bots/{id}/stop        → encerra antes do horário
 *   GET  /api/v1/bots/{id}/transcript  → texto (não usamos — preferimos AssemblyAI próprio)
 *   GET  /api/v1/bots/{id}/recording   → URL temporária do MP3/WAV
 *
 * NOTA: Os caminhos exatos podem variar entre versões. Mantemos um único ponto
 * de configuração (paths constantes no topo da classe) para mudança rápida.
 */

const CreateBotResponseSchema = z
  .object({
    bot_id: z.string().min(1),
    status: z.string().optional(),
  })
  .passthrough();

const StatusBotSchema = z
  .object({
    bot_id: z.string(),
    status: z.string(),
  })
  .passthrough();

const RecordingResponseSchema = z
  .object({
    recording_url: z.string().url().optional(),
    audio_url: z.string().url().optional(),
    duration_ms: z.number().int().nonnegative().optional(),
    mime_type: z.string().optional(),
  })
  .passthrough();

export interface CriarBotInput {
  meetUrl: string;
  /** URL absoluta HTTPS do nosso endpoint /webhooks/meetstream. */
  webhookUrl: string;
  /** Nome humano que aparecerá na sala (ex.: "Bot Unifique — Recrutamento"). */
  nomeExibido?: string;
  /** Idioma para legenda interna do MeetStream (não é a nossa transcrição). */
  idioma?: string;
}

export interface CriarBotResultado {
  botId: string;
  status?: string;
}

export interface GravacaoMeta {
  url: string;
  duracaoMs?: number;
  mimeType?: string;
}

/** Segmento normalizado de transcript (shape comum a assembly/meetstream). */
export interface TranscriptSegmento {
  inicio_ms?: number;
  fim_ms?: number;
  falante?: string;
  texto: string;
}

export interface TranscriptMeta {
  texto: string;
  segmentos: TranscriptSegmento[];
}

@Injectable()
export class MeetStreamClient {
  private readonly logger = new Logger(MeetStreamClient.name);
  private readonly http: AxiosInstance;
  private readonly paths = {
    criarBot: '/api/v1/bots/create_bot',
    statusBot: (id: string) => `/api/v1/bots/${encodeURIComponent(id)}`,
    pararBot: (id: string) => `/api/v1/bots/${encodeURIComponent(id)}/stop`,
    gravacao: (id: string) =>
      `/api/v1/bots/${encodeURIComponent(id)}/recording`,
    transcript: (id: string) =>
      `/api/v1/bots/${encodeURIComponent(id)}/transcript`,
  };

  constructor(private readonly config: ConfigService) {
    // Opcional: sem a key, o client é construído mas as chamadas falham em runtime
    // (MeetStream não é usado até o bot de entrevista ser ligado). Não derruba o boot.
    const apiKey = this.config.get<string>('MEETSTREAM_API_KEY') ?? '';
    const baseURL =
      this.config.get<string>('MEETSTREAM_BASE_URL') ??
      'https://api.meetstream.ai';

    this.http = axios.create({
      baseURL,
      timeout: this.config.getOrThrow<number>('MEETSTREAM_TIMEOUT_MS'),
      headers: {
        Authorization: `Token ${apiKey}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    });

    axiosRetry(this.http, {
      retries: this.config.getOrThrow<number>('MEETSTREAM_RETRY_MAX'),
      retryDelay: axiosRetry.exponentialDelay,
      retryCondition: (error) => {
        const status = error.response?.status;
        // 422/400 = validação → não retentar.
        if (status === 422 || status === 400) return false;
        return (
          axiosRetry.isNetworkOrIdempotentRequestError(error) ||
          status === 429 ||
          (status !== undefined && status >= 500)
        );
      },
    });
  }

  async criarBot(input: CriarBotInput): Promise<CriarBotResultado> {
    this.validarMeetUrl(input.meetUrl);
    this.validarWebhookUrl(input.webhookUrl);

    try {
      const resp = await this.http.post(this.paths.criarBot, {
        meeting_link: input.meetUrl,
        webhook_url: input.webhookUrl,
        bot_name: input.nomeExibido ?? 'Bot Unifique — Recrutamento',
        language: input.idioma ?? 'pt-BR',
        audio_required: true,
        // BAKE-OFF: ligamos o transcript interno do MeetStream para compará-lo
        // com o AssemblyAI (que roda sobre o áudio). Ver TranscricaoBench.
        transcript_required: true,
      });
      const parsed = CreateBotResponseSchema.parse(resp.data);
      this.logger.log(`Bot MeetStream criado: ${parsed.bot_id}`);
      return { botId: parsed.bot_id, status: parsed.status };
    } catch (err) {
      throw this.normalizarErro(err, 'criarBot');
    }
  }

  async statusBot(botId: string): Promise<{ botId: string; status: string }> {
    try {
      const resp = await this.http.get(this.paths.statusBot(botId));
      const parsed = StatusBotSchema.parse(resp.data);
      return { botId: parsed.bot_id, status: parsed.status };
    } catch (err) {
      throw this.normalizarErro(err, 'statusBot');
    }
  }

  async pararBot(botId: string): Promise<void> {
    try {
      await this.http.post(this.paths.pararBot(botId), {});
    } catch (err) {
      throw this.normalizarErro(err, 'pararBot');
    }
  }

  async obterGravacao(botId: string): Promise<GravacaoMeta | null> {
    try {
      const resp = await this.http.get(this.paths.gravacao(botId));
      const parsed = RecordingResponseSchema.parse(resp.data);
      const url = parsed.recording_url ?? parsed.audio_url;
      if (!url) return null;
      return {
        url,
        duracaoMs: parsed.duration_ms,
        mimeType: parsed.mime_type,
      };
    } catch (err) {
      if (isAxiosError(err) && err.response?.status === 404) return null;
      throw this.normalizarErro(err, 'obterGravacao');
    }
  }

  /**
   * Busca o transcript interno do MeetStream (BAKE-OFF — comparação com o
   * AssemblyAI). A forma exata da resposta não é documentada de forma estável,
   * então normalizamos de forma permissiva e logamos o cru no 1º uso para
   * ajuste fino. Retorna `null` se o transcript ainda não está pronto (404).
   */
  async obterTranscript(botId: string): Promise<TranscriptMeta | null> {
    try {
      const resp = await this.http.get(this.paths.transcript(botId));
      const meta = this.normalizarTranscript(resp.data);
      this.logger.debug(
        `MeetStream transcript bot=${botId} segmentos=${meta.segmentos.length} ` +
          `chars=${meta.texto.length} raw=${JSON.stringify(resp.data).slice(0, 600)}`,
      );
      return meta;
    } catch (err) {
      if (isAxiosError(err) && err.response?.status === 404) return null;
      throw this.normalizarErro(err, 'obterTranscript');
    }
  }

  /**
   * Normaliza shapes conhecidos/prováveis do transcript do MeetStream:
   *   - { transcript: "texto..." }
   *   - { transcript: [ {speaker, text, start, end}, ... ] }
   *   - { segments|utterances|words: [ ... ] }
   *   - "texto..." (string pura)
   * Campos de tempo aceitam ms ou segundos (heurística: < 10000 ⇒ segundos).
   */
  private normalizarTranscript(data: unknown): TranscriptMeta {
    if (typeof data === 'string') {
      return { texto: data.trim(), segmentos: [] };
    }
    if (!data || typeof data !== 'object') {
      return { texto: '', segmentos: [] };
    }
    const obj = data as Record<string, unknown>;

    const arr =
      this.primeiroArray(obj.segments) ??
      this.primeiroArray(obj.utterances) ??
      this.primeiroArray(obj.transcript) ??
      this.primeiroArray(obj.results) ??
      this.primeiroArray(obj.words);

    if (arr) {
      const segmentos: TranscriptSegmento[] = arr
        .map((s) => this.normalizarSegmento(s))
        .filter((s): s is TranscriptSegmento => s !== null);
      const texto = segmentos
        .map((s) => (s.falante ? `${s.falante}: ${s.texto}` : s.texto))
        .join('\n')
        .trim();
      return { texto, segmentos };
    }

    // Sem array de segmentos: tenta um campo de texto plano.
    const textoPlano =
      (typeof obj.transcript === 'string' && obj.transcript) ||
      (typeof obj.text === 'string' && obj.text) ||
      (typeof obj.full_text === 'string' && obj.full_text) ||
      '';
    return { texto: String(textoPlano).trim(), segmentos: [] };
  }

  private primeiroArray(v: unknown): unknown[] | null {
    return Array.isArray(v) && v.length > 0 ? v : null;
  }

  private normalizarSegmento(s: unknown): TranscriptSegmento | null {
    if (!s || typeof s !== 'object') return null;
    const o = s as Record<string, unknown>;
    const texto = String(o.text ?? o.transcript ?? o.content ?? o.word ?? '').trim();
    if (!texto) return null;
    const falante =
      (o.speaker as string | undefined) ??
      (o.speaker_label as string | undefined) ??
      (o.speaker_name as string | undefined) ??
      undefined;
    return {
      texto,
      falante: falante != null ? String(falante) : undefined,
      inicio_ms: this.paraMs(o.start ?? o.start_ms ?? o.start_time ?? o.begin),
      fim_ms: this.paraMs(o.end ?? o.end_ms ?? o.end_time),
    };
  }

  private paraMs(v: unknown): number | undefined {
    if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
    // Heurística: valores pequenos provavelmente estão em segundos.
    return v < 10_000 ? Math.round(v * 1000) : Math.round(v);
  }

  /**
   * Baixa o áudio bruto do MeetStream. URL é assinada pelo provedor; aplicamos
   * o mesmo SSRF guard básico (HTTPS-only) por defesa.
   */
  async baixarAudio(url: string): Promise<{ data: Buffer; contentType: string }> {
    if (!url.startsWith('https://')) {
      throw new BadRequestException('URL de áudio deve ser HTTPS.');
    }
    try {
      const resp = await this.http.get<ArrayBuffer>(url, {
        responseType: 'arraybuffer',
        // Token NÃO vai junto — URL é pre-signed.
        headers: { Authorization: '' },
        // Limite hard: 200 MB por entrevista (entrevistas de 1h em mp3 ≈ 60MB).
        maxContentLength: 200 * 1024 * 1024,
        maxBodyLength: 200 * 1024 * 1024,
      });
      return {
        data: Buffer.from(resp.data),
        contentType: String(resp.headers['content-type'] ?? 'audio/mpeg'),
      };
    } catch (err) {
      throw this.normalizarErro(err, 'baixarAudio');
    }
  }

  /** ----------------------------------------------------------------------
   *  Internos
   *  --------------------------------------------------------------------- */

  private validarMeetUrl(url: string): void {
    try {
      const u = new URL(url);
      if (u.protocol !== 'https:') {
        throw new BadRequestException('meetUrl deve ser HTTPS.');
      }
      const hosts = ['meet.google.com', 'zoom.us', 'teams.microsoft.com'];
      if (!hosts.some((h) => u.host === h || u.host.endsWith(`.${h}`))) {
        throw new BadRequestException(
          `meetUrl host não suportado: ${u.host}`,
        );
      }
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException(`meetUrl inválida: ${url}`);
    }
  }

  private validarWebhookUrl(url: string): void {
    try {
      const u = new URL(url);
      if (u.protocol !== 'https:' && u.host !== 'localhost' && u.host.indexOf('ngrok') === -1) {
        // permite HTTP localhost e ngrok em dev; produção exige HTTPS
        throw new BadRequestException('webhookUrl deve ser HTTPS.');
      }
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException(`webhookUrl inválida: ${url}`);
    }
  }

  private normalizarErro(err: unknown, op: string): Error {
    if (isAxiosError(err)) {
      const status = err.response?.status;
      this.logger.error(
        `MeetStream ${op} status=${status} body=${JSON.stringify(err.response?.data ?? err.message).slice(0, 400)}`,
      );
      if (status === 400 || status === 422) {
        return new BadRequestException(
          `MeetStream recusou payload em ${op}.`,
        );
      }
      if (status === 429 || (status && status >= 500)) {
        return new ServiceUnavailableException(
          `MeetStream indisponível (${status}) — job será re-tentado.`,
        );
      }
    } else {
      this.logger.error(`MeetStream ${op} erro: ${(err as Error).message}`);
    }
    return new InternalServerErrorException(`Falha em MeetStream ${op}.`);
  }
}
