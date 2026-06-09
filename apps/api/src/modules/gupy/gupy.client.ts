import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError, AxiosInstance, AxiosRequestConfig } from 'axios';
import axiosRetry from 'axios-retry';
import Bottleneck from 'bottleneck';
import { z } from 'zod';

import {
  CandidaturaGupy,
  CandidaturaGupySchema,
  EstruturaItemGupySchema,
  EtapaGupy,
  EtapaGupySchema,
  OpcaoEstruturaDTO,
  PaginacaoEstruturaGupySchema,
  PaginacaoGupySchema,
  VagaCriadaGupy,
  VagaCriadaGupySchema,
  VagaGupy,
  VagaGupySchema,
} from '@uniats/shared';

import {
  CriarVagaGupyPayload,
  ListarCandidaturasParams,
  ListarEstruturaParams,
  ListarEtapasParams,
  ListarVagasParams,
  MoverCandidaturaParams,
} from './gupy.types.js';

export class GupyApiError extends Error {
  constructor(
    message: string,
    public readonly status: number | undefined,
    public readonly detalhes?: unknown,
  ) {
    super(message);
    this.name = 'GupyApiError';
  }
}

/**
 * Cliente HTTP único para a Gupy.
 *
 * Defesas em camada:
 * - Bearer token nunca aparece em logs (interceptor + redact no pino).
 * - axios-retry com backoff exponencial em 5xx e 429 (respeitando Retry-After).
 * - Bottleneck enforça o rate-limit (RPS configurável via env).
 * - Timeout duro por request.
 * - Validação de resposta com Zod — payload inesperado vira erro tipado.
 */
@Injectable()
export class GupyClient {
  private readonly logger = new Logger(GupyClient.name);
  private readonly http: AxiosInstance;
  /** Cliente para a API de estrutura organizacional (base /os/v1). */
  private readonly httpOs: AxiosInstance;
  private readonly limiter: Bottleneck;

  constructor(private readonly config: ConfigService) {
    const baseURL = config.getOrThrow<string>('GUPY_API_BASE_URL');
    const osBaseURL =
      config.get<string>('GUPY_OS_API_BASE_URL') ?? 'https://api.gupy.io/os/v1';
    const token = config.getOrThrow<string>('GUPY_API_TOKEN');
    const timeout = config.get<number>('GUPY_TIMEOUT_MS') ?? 15_000;
    const rps = config.get<number>('GUPY_RATE_LIMIT_RPS') ?? 5;
    const retries = config.get<number>('GUPY_RETRY_MAX') ?? 4;
    const retryBase = config.get<number>('GUPY_RETRY_BASE_MS') ?? 500;

    const commonHeaders = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'User-Agent': 'triagem-api/0.1 (+unifique.com.br)',
    };

    this.http = axios.create({
      baseURL,
      timeout,
      headers: commonHeaders,
      // Hardening — limita o tamanho do payload aceito pelo cliente.
      maxContentLength: 10 * 1024 * 1024,
      maxBodyLength: 5 * 1024 * 1024,
      validateStatus: (s) => s >= 200 && s < 300,
    });

    this.httpOs = axios.create({
      baseURL: osBaseURL,
      timeout,
      headers: commonHeaders,
      maxContentLength: 10 * 1024 * 1024,
      maxBodyLength: 5 * 1024 * 1024,
      validateStatus: (s) => s >= 200 && s < 300,
    });

    const retryOptions: Parameters<typeof axiosRetry>[1] = {
      retries,
      retryDelay: (count, error) => {
        // Respeita Retry-After se a Gupy enviar
        const retryAfter = error?.response?.headers?.['retry-after'];
        if (retryAfter) {
          const seconds = Number(retryAfter);
          if (!Number.isNaN(seconds)) return seconds * 1000;
        }
        return retryBase * 2 ** (count - 1) + Math.floor(Math.random() * 200);
      },
      retryCondition: (error: AxiosError) => {
        const status = error.response?.status;
        return (
          axiosRetry.isNetworkError(error) ||
          status === 429 ||
          (typeof status === 'number' && status >= 500 && status <= 599)
        );
      },
      onRetry: (count, error, requestConfig) => {
        this.logger.warn(
          `Retry ${count}/${retries} em ${requestConfig.method?.toUpperCase()} ${requestConfig.url} ` +
            `(status=${error.response?.status ?? 'network'})`,
        );
      },
    };
    axiosRetry(this.http, retryOptions);
    axiosRetry(this.httpOs, retryOptions);

    // Rate-limit: máximo `rps` requisições por segundo.
    this.limiter = new Bottleneck({
      reservoir: rps,
      reservoirRefreshAmount: rps,
      reservoirRefreshInterval: 1000,
      maxConcurrent: rps,
      minTime: Math.floor(1000 / rps),
    });
  }

  /** ------------------------------------------------------------------
   *  Operações públicas
   *  -----------------------------------------------------------------*/

  async listarVagas(params: ListarVagasParams = {}): Promise<VagaGupy[]> {
    const data = await this.get(
      '/jobs',
      { ...params, fields: 'all' },
      PaginacaoGupySchema(VagaGupySchema),
    );
    return data.data;
  }

  /** Itera todas as páginas de vagas (gera async). */
  async *iterarVagas(
    params: ListarVagasParams = {},
  ): AsyncGenerator<VagaGupy, void, void> {
    let page = 1;
    const perPage = params.perPage ?? 100;
    while (true) {
      const resp = await this.get(
        '/jobs',
        { ...params, page, perPage, fields: 'all' },
        PaginacaoGupySchema(VagaGupySchema),
      );
      for (const v of resp.data) yield v;
      if (resp.data.length < perPage) return;
      page += 1;
      if (page > 1000) {
        this.logger.warn('Loop de paginação de vagas atingiu o limite duro');
        return;
      }
    }
  }

  async listarCandidaturasDaVaga(
    params: ListarCandidaturasParams,
  ): Promise<CandidaturaGupy[]> {
    const data = await this.get(
      `/jobs/${params.jobId}/applications`,
      { status: params.status, step: params.step, page: params.page, perPage: params.perPage, fields: 'all' },
      PaginacaoGupySchema(CandidaturaGupySchema),
    );
    return data.data;
  }

  async *iterarCandidaturas(
    params: ListarCandidaturasParams,
  ): AsyncGenerator<CandidaturaGupy, void, void> {
    let page = 1;
    const perPage = params.perPage ?? 100;
    while (true) {
      const resp = await this.get(
        `/jobs/${params.jobId}/applications`,
        { ...params, page, perPage, fields: 'all' },
        PaginacaoGupySchema(CandidaturaGupySchema),
      );
      for (const c of resp.data) yield c;
      if (resp.data.length < perPage) return;
      page += 1;
      if (page > 1000) {
        this.logger.warn('Loop de paginação de candidaturas atingiu o limite duro');
        return;
      }
    }
  }

  async obterCandidatura(id: bigint): Promise<CandidaturaGupy> {
    return await this.get(
      `/companies/applications/${id}`,
      undefined,
      CandidaturaGupySchema,
    );
  }

  async obterVaga(id: bigint): Promise<VagaGupy> {
    return await this.get(`/jobs/${id}`, undefined, VagaGupySchema);
  }

  /** Lista as etapas (steps) de uma vaga — fonte dos `currentStepId`. */
  async listarEtapasDaVaga(params: ListarEtapasParams): Promise<EtapaGupy[]> {
    const data = await this.get(
      `/jobs/${params.jobId}/steps`,
      { page: params.page, perPage: params.perPage },
      PaginacaoGupySchema(EtapaGupySchema),
    );
    return data.data;
  }

  /**
   * Move uma candidatura entre etapas e/ou altera seu status.
   * Pelo menos um entre `currentStepId` e `status` é obrigatório.
   *
   * A operação é idempotente (mover para a mesma etapa / setar o mesmo
   * status repetidamente tem o mesmo efeito), portanto o retry automático
   * em 429/5xx do client é seguro aqui.
   */
  async moverCandidatura(params: MoverCandidaturaParams): Promise<void> {
    const {
      jobId,
      applicationId,
      currentStepId,
      status,
      disapprovalReason,
      disapprovalReasonNotes,
    } = params;

    if (currentStepId === undefined && status === undefined) {
      throw new GupyApiError(
        'moverCandidatura exige currentStepId e/ou status',
        400,
      );
    }
    if (status !== undefined && status !== 'in_process' && status !== 'reproved') {
      throw new GupyApiError(
        `status inválido: '${status}' (use 'in_process' ou 'reproved')`,
        400,
      );
    }

    // bigint não é serializável em JSON — convertemos o stepId para number.
    const body: Record<string, unknown> = {};
    if (currentStepId !== undefined) body.currentStepId = Number(currentStepId);
    if (status !== undefined) body.status = status;
    if (disapprovalReason !== undefined) body.disapprovalReason = disapprovalReason;
    if (disapprovalReasonNotes !== undefined) {
      body.disapprovalReasonNotes = disapprovalReasonNotes.slice(0, 255);
    }

    await this.patch(`/jobs/${jobId}/applications/${applicationId}`, body);
    this.logger.log(
      `Candidatura ${applicationId} movida (job=${jobId}, ` +
        `step=${currentStepId ?? '-'}, status=${status ?? '-'})`,
    );
  }

  /** ------------------------------------------------------------------
   *  Escrita — criação e publicação de vaga
   *  -----------------------------------------------------------------*/

  /**
   * Cria uma vaga na Gupy. TODA vaga criada via API nasce em RASCUNHO;
   * para publicar é necessário chamar `publicarVaga` em seguida.
   */
  async criarVaga(payload: CriarVagaGupyPayload): Promise<VagaCriadaGupy> {
    const vaga = await this.post('/jobs', payload, VagaCriadaGupySchema);
    this.logger.log(`Vaga criada na Gupy (id=${vaga.id}, rascunho)`);
    return vaga;
  }

  /**
   * Publica uma vaga existente (sai de rascunho).
   * A Gupy publica via PATCH com `status: 'published'`. Se o tenant exigir um
   * shape diferente, ajustar APENAS aqui.
   */
  async publicarVaga(jobId: bigint): Promise<void> {
    await this.patch(`/jobs/${jobId}`, { status: 'published' });
    this.logger.log(`Vaga ${jobId} publicada na Gupy`);
  }

  /** ------------------------------------------------------------------
   *  Estrutura organizacional (base /os/v1) — para os selects do form
   *  -----------------------------------------------------------------*/

  async listarDepartamentos(
    params: ListarEstruturaParams = {},
  ): Promise<OpcaoEstruturaDTO[]> {
    return this.listarEstrutura('/departments', params);
  }

  async listarCargos(
    params: ListarEstruturaParams = {},
  ): Promise<OpcaoEstruturaDTO[]> {
    return this.listarEstrutura('/roles', params);
  }

  async listarFiliais(
    params: ListarEstruturaParams = {},
  ): Promise<OpcaoEstruturaDTO[]> {
    return this.listarEstrutura('/branches', params);
  }

  private async listarEstrutura(
    path: string,
    params: ListarEstruturaParams,
  ): Promise<OpcaoEstruturaDTO[]> {
    const query = {
      name: params.name,
      page: params.page ?? 1,
      maxPageSize: params.maxPageSize ?? 50,
    };
    const resp = await this.getOs(
      path,
      query,
      PaginacaoEstruturaGupySchema(EstruturaItemGupySchema),
    );
    return resp.data
      .map((item) => {
        // A API de /os/v1 usa `id` numérico; algumas rotas usam `code`.
        const rawId = item.id ?? item.code;
        const id = rawId != null ? Number(rawId) : NaN;
        const nome = item.name ?? item.description ?? '';
        return { id, nome };
      })
      .filter((o) => Number.isFinite(o.id) && o.id > 0 && o.nome.length > 0);
  }

  /**
   * Faz download do currículo (PDF/DOCX) em memória.
   * IMPORTANTE: o resultado é binário — chamador é responsável por persistir.
   */
  async baixarCurriculo(url: string): Promise<{ data: Buffer; contentType: string }> {
    // URL é validada pelo Zod no schema (z.string().url()).
    // Bloqueamos qualquer URL que não seja https → defesa contra SSRF.
    if (!url.startsWith('https://')) {
      throw new GupyApiError('URL de currículo inválida (não-HTTPS)', 400);
    }
    return await this.limiter.schedule(async () => {
      try {
        const resp = await this.http.get<ArrayBuffer>(url, {
          responseType: 'arraybuffer',
          // Token NÃO vai junto: URLs de CV costumam ser pre-signed.
          headers: { Authorization: '' },
          maxContentLength: 20 * 1024 * 1024, // 20 MB hard cap
        });
        return {
          data: Buffer.from(resp.data),
          contentType: String(resp.headers['content-type'] ?? 'application/octet-stream'),
        };
      } catch (err) {
        throw this.normalizarErro(err, 'baixarCurriculo');
      }
    });
  }

  /** ------------------------------------------------------------------
   *  Internos
   *  -----------------------------------------------------------------*/

  private async get<T extends z.ZodTypeAny>(
    path: string,
    query: Record<string, unknown> | undefined,
    schema: T,
    extra?: AxiosRequestConfig,
  ): Promise<z.infer<T>> {
    return await this.limiter.schedule(async () => {
      try {
        const resp = await this.http.get(path, { params: query, ...extra });
        const parsed = schema.safeParse(resp.data);
        if (!parsed.success) {
          throw new GupyApiError(
            `Resposta da Gupy não passou no schema (${path})`,
            resp.status,
            parsed.error.flatten(),
          );
        }
        return parsed.data;
      } catch (err) {
        if (err instanceof GupyApiError) throw err;
        throw this.normalizarErro(err, `GET ${path}`);
      }
    });
  }

  /** GET na API de estrutura organizacional (/os/v1). */
  private async getOs<T extends z.ZodTypeAny>(
    path: string,
    query: Record<string, unknown> | undefined,
    schema: T,
  ): Promise<z.infer<T>> {
    return await this.limiter.schedule(async () => {
      try {
        const resp = await this.httpOs.get(path, { params: query });
        const parsed = schema.safeParse(resp.data);
        if (!parsed.success) {
          throw new GupyApiError(
            `Resposta da Gupy (os) não passou no schema (${path})`,
            resp.status,
            parsed.error.flatten(),
          );
        }
        return parsed.data;
      } catch (err) {
        if (err instanceof GupyApiError) throw err;
        throw this.normalizarErro(err, `GET (os) ${path}`);
      }
    });
  }

  /** POST com rate-limit + validação de resposta com Zod. */
  private async post<T extends z.ZodTypeAny>(
    path: string,
    body: unknown,
    schema: T,
  ): Promise<z.infer<T>> {
    return await this.limiter.schedule(async () => {
      try {
        const resp = await this.http.post(path, body);
        const parsed = schema.safeParse(resp.data);
        if (!parsed.success) {
          throw new GupyApiError(
            `Resposta da Gupy não passou no schema (POST ${path})`,
            resp.status,
            parsed.error.flatten(),
          );
        }
        return parsed.data;
      } catch (err) {
        if (err instanceof GupyApiError) throw err;
        throw this.normalizarErro(err, `POST ${path}`);
      }
    });
  }

  /**
   * PATCH com rate-limit + normalização de erro.
   * A Gupy responde 200 sem corpo útil em alterações de candidatura,
   * então não validamos a resposta com Zod (apenas propagamos erros).
   */
  private async patch(path: string, body: unknown): Promise<void> {
    return await this.limiter.schedule(async () => {
      try {
        await this.http.patch(path, body);
      } catch (err) {
        if (err instanceof GupyApiError) throw err;
        throw this.normalizarErro(err, `PATCH ${path}`);
      }
    });
  }

  private normalizarErro(err: unknown, contexto: string): GupyApiError {
    if (axios.isAxiosError(err)) {
      const status = err.response?.status;
      const body = err.response?.data;
      // NUNCA logar headers (tem o Authorization).
      this.logger.error(
        `Falha em ${contexto}: status=${status ?? 'network'} msg=${err.message}`,
      );
      return new GupyApiError(
        `Falha em ${contexto}: ${err.message}`,
        status,
        body,
      );
    }
    return new GupyApiError(
      `Erro inesperado em ${contexto}`,
      undefined,
      String(err),
    );
  }
}
