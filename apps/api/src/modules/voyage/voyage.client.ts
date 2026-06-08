import {
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance, isAxiosError } from 'axios';
import axiosRetry from 'axios-retry';
import Bottleneck from 'bottleneck';
import { z } from 'zod';

import type { EmbedRequest, EmbedResponse } from './voyage.types.js';

/**
 * Resposta esperada da API Voyage `/v1/embeddings`.
 * Documentada em: https://docs.voyageai.com/reference/embeddings-api
 */
const VoyageResponseSchema = z.object({
  object: z.literal('list'),
  data: z
    .array(
      z.object({
        object: z.literal('embedding'),
        embedding: z.array(z.number()).min(1),
        index: z.number().int().nonnegative(),
      }),
    )
    .min(1),
  model: z.string(),
  usage: z.object({
    total_tokens: z.number().int().nonnegative(),
  }),
});

const VOYAGE_MAX_BATCH = 128;
const VOYAGE_MAX_TOKENS_INPUT = 32_000; // voyage-3 supporta 32K tokens por input

@Injectable()
export class VoyageClient {
  private readonly logger = new Logger(VoyageClient.name);
  private readonly http: AxiosInstance | null;
  private readonly modelo: string;
  private readonly dimensoesEsperadas: number;
  /** Throttle client-side para respeitar o rate limit da Voyage (evita 429). */
  private readonly limiter: Bottleneck;

  constructor(private readonly config: ConfigService) {
    this.modelo = this.config.get<string>('VOYAGE_MODEL') ?? 'voyage-3';
    this.dimensoesEsperadas =
      this.config.get<number>('VOYAGE_DIMENSIONS') ?? 1024;

    // Espaça as chamadas conforme o tier da chave. minTime = 60000/RPM garante
    // que duas requisições nunca saiam dentro da mesma janela de rate limit.
    const rpm = this.config.get<number>('VOYAGE_RATE_LIMIT_RPM') ?? 3;
    const maxConcurrent = this.config.get<number>('VOYAGE_MAX_CONCURRENT') ?? 1;
    // +10% de margem: com minTime = exatamente 60000/RPM, uma janela deslizante
    // de 60s do servidor ainda pega RPM+1 requisições na borda (race → 429).
    this.limiter = new Bottleneck({
      maxConcurrent,
      minTime: Math.ceil((60_000 / rpm) * 1.1),
    });

    const apiKey = this.config.get<string>('VOYAGE_API_KEY');
    if (!apiKey) {
      // MVP sem Voyage: cliente fica inerte; chamadas a embed() falham com 503.
      this.logger.warn(
        'VOYAGE_API_KEY ausente — ranking por embeddings DESABILITADO neste ambiente.',
      );
      this.http = null;
      return;
    }

    const baseURL =
      this.config.get<string>('VOYAGE_API_BASE_URL') ??
      'https://api.voyageai.com';
    const timeout = this.config.getOrThrow<number>('VOYAGE_TIMEOUT_MS');

    this.http = axios.create({
      baseURL,
      timeout,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'triagem-api/1.0 (+voyage-client)',
      },
    });

    axiosRetry(this.http, {
      retries: this.config.getOrThrow<number>('VOYAGE_RETRY_MAX'),
      retryDelay: (count, error) => {
        // Respeita Retry-After se a Voyage mandar
        const ra = Number((error as any)?.response?.headers?.['retry-after']);
        if (!Number.isNaN(ra) && ra > 0) return Math.min(ra * 1000, 30_000);
        return axiosRetry.exponentialDelay(count);
      },
      retryCondition: (error) => {
        // Sem resposta (status=undefined) = erro de rede/timeout (ECONNABORTED,
        // ECONNRESET, socket esgotado sob carga). axios-retry NÃO re-tenta timeout
        // por padrão — aqui re-tentamos, pois costuma ser transitório.
        if (!error.response) return true;
        const status = error.response.status;
        return status === 429 || status >= 500;
      },
    });
  }

  /**
   * Gera embeddings para um batch (≤ 128 inputs) em UMA chamada.
   * Para arrays maiores, use `embedManyBatched()`.
   */
  async embed(req: EmbedRequest): Promise<EmbedResponse> {
    if (!this.http) {
      throw new ServiceUnavailableException(
        'Voyage não configurado (VOYAGE_API_KEY ausente) — embeddings desabilitados no MVP.',
      );
    }
    if (!req.textos.length) {
      throw new Error('embed: array de textos vazio.');
    }
    if (req.textos.length > VOYAGE_MAX_BATCH) {
      throw new Error(
        `embed: batch acima do limite (${req.textos.length} > ${VOYAGE_MAX_BATCH}).`,
      );
    }

    // Sanitização básica: não enviar strings vazias/só whitespace — a API rejeita.
    const inputs = req.textos.map((t, i) => {
      const txt = (t ?? '').trim();
      if (!txt) {
        throw new Error(`embed: texto[${i}] vazio.`);
      }
      // Truncamento defensivo por caracteres (≈ 4 chars/token para PT-BR).
      return txt.slice(0, VOYAGE_MAX_TOKENS_INPUT * 4);
    });

    let raw: unknown;
    const http = this.http;
    try {
      // Passa pelo limiter: requisições concorrentes são enfileiradas e espaçadas.
      const resp = await this.limiter.schedule(() =>
        http.post('/v1/embeddings', {
          input: inputs,
          model: this.modelo,
          input_type: req.inputType,
        }),
      );
      raw = resp.data;
    } catch (err) {
      if (isAxiosError(err)) {
        const status = err.response?.status;
        if (status === 429 || (status && status >= 500)) {
          this.logger.warn(`Voyage indisponível (status=${status}).`);
          throw new ServiceUnavailableException(
            'Voyage indisponível — job será re-tentado.',
          );
        }
        this.logger.error(
          `Voyage falhou (status=${status}): ${JSON.stringify(err.response?.data ?? err.message)}`,
        );
      } else {
        this.logger.error(`Voyage erro: ${(err as Error).message}`);
      }
      throw new InternalServerErrorException('Falha ao chamar Voyage.');
    }

    const parsed = VoyageResponseSchema.safeParse(raw);
    if (!parsed.success) {
      this.logger.error(
        `Resposta Voyage não bate com schema: ${parsed.error.message}`,
      );
      throw new InternalServerErrorException(
        'Resposta inesperada da Voyage.',
      );
    }
    const body = parsed.data;

    // A API pode devolver embeddings em ordem diferente — reordenamos por `index`.
    const ordenados = [...body.data].sort((a, b) => a.index - b.index);

    // Validação determinística da dimensão — se mudar, falha alto antes do banco.
    for (const e of ordenados) {
      if (e.embedding.length !== this.dimensoesEsperadas) {
        throw new InternalServerErrorException(
          `Dimensão inesperada: ${e.embedding.length} ≠ ${this.dimensoesEsperadas}`,
        );
      }
    }

    return {
      vetores: ordenados.map((e) => e.embedding),
      modelo: body.model,
      usage: body.usage,
    };
  }

  /**
   * Wrapper que fatiamento em batches de 128 e concatena. Mantém ordem global.
   */
  async embedManyBatched(textos: string[]): Promise<EmbedResponse> {
    const all: number[][] = [];
    let totalTokens = 0;
    let modelo = this.modelo;

    for (let i = 0; i < textos.length; i += VOYAGE_MAX_BATCH) {
      const slice = textos.slice(i, i + VOYAGE_MAX_BATCH);
      const out = await this.embed({ textos: slice, inputType: 'document' });
      all.push(...out.vetores);
      totalTokens += out.usage.total_tokens;
      modelo = out.modelo;
    }

    return {
      vetores: all,
      modelo,
      usage: { total_tokens: totalTokens },
    };
  }
}
