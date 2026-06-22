import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import axiosRetry from 'axios-retry';
import Bottleneck from 'bottleneck';
import { z } from 'zod';

import {
  AbrirSolicitacaoInput,
  AbrirSolicitacaoResult,
  AcessoProvider,
} from './acesso-provider.interface.js';

export class AceleratoApiError extends Error {
  constructor(
    message: string,
    public readonly status: number | undefined,
    public readonly detalhes?: unknown,
  ) {
    super(message);
    this.name = 'AceleratoApiError';
  }
}

/** Resposta de criação de chamado (parse defensivo — só o que usamos). */
const ChamadoCriadoSchema = z
  .object({
    ticketKey: z.union([z.number(), z.string()]).optional(),
    id: z.union([z.number(), z.string()]).optional(),
    url: z.string().optional(),
  })
  .passthrough();

function escaparHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Provider de criação de acesso via Acelerato (abertura de chamado).
 *
 * IMPORTANTE: este provider é sempre instanciado (faz parte do AcessoModule),
 * mas as credenciais só são exigidas QUANDO ele é de fato usado
 * (ACESSO_PROVIDER=acelerato). Por isso a leitura é preguiçosa: o construtor
 * não lança, e o cliente HTTP só é montado no primeiro `abrirSolicitacao`.
 *
 * Defesas (mesmo padrão do GupyClient): Basic Auth, axios-retry em 5xx/429,
 * Bottleneck para o rate-limit (2 × licenças/min), timeout duro, parse
 * defensivo da resposta. Atenção (rede Unifique): chamadas a *.acelerato.com
 * exigem NODE_EXTRA_CA_CERTS, senão dá SELF_SIGNED_CERT_IN_CHAIN.
 */
@Injectable()
export class AceleratoProvider implements AcessoProvider {
  readonly nome = 'acelerato';
  private readonly logger = new Logger(AceleratoProvider.name);
  private readonly limiter: Bottleneck;
  private http?: AxiosInstance;

  private readonly baseURL?: string;
  private readonly email?: string;
  private readonly token?: string;
  private readonly timeout: number;
  private readonly retries: number;
  private readonly projetoKey?: number;
  private readonly especieDeTicketKey?: string;
  private readonly tipoDeTicketKey?: string;
  private readonly categoriaKey?: string;
  private readonly prioridadeKey?: string;

  constructor(private readonly config: ConfigService) {
    // Leitura preguiçosa: get (não getOrThrow) para não quebrar o boot quando
    // ACESSO_PROVIDER=desabilitado. A obrigatoriedade já é validada no
    // env.validation quando ACESSO_PROVIDER=acelerato.
    this.baseURL = config.get<string>('ACELERATO_BASE_URL');
    this.email = config.get<string>('ACELERATO_API_EMAIL');
    this.token = config.get<string>('ACELERATO_API_TOKEN');
    this.timeout = config.get<number>('ACELERATO_TIMEOUT_MS') ?? 15_000;
    this.retries = config.get<number>('ACELERATO_RETRY_MAX') ?? 3;
    this.projetoKey = config.get<number>('ACELERATO_PROJETO_KEY');
    this.especieDeTicketKey = config.get<string>('ACELERATO_ESPECIE_TICKET_KEY');
    this.tipoDeTicketKey = config.get<string>('ACELERATO_TIPO_TICKET_KEY');
    this.categoriaKey = config.get<string>('ACELERATO_CATEGORIA_KEY');
    this.prioridadeKey = config.get<string>('ACELERATO_PRIORIDADE_KEY');

    const rpm = config.get<number>('ACELERATO_RATE_LIMIT_RPM') ?? 20;
    // Rate-limit: 2 × licenças/min. minTime = janela por request (+10% margem).
    this.limiter = new Bottleneck({
      minTime: Math.ceil((60_000 / Math.max(1, rpm)) * 1.1),
      maxConcurrent: 1,
    });
  }

  /** Monta (uma vez) o cliente HTTP; lança se faltar credencial. */
  private getHttp(): AxiosInstance {
    if (this.http) return this.http;
    if (!this.baseURL || !this.email || !this.token) {
      throw new AceleratoApiError(
        'Acelerato não configurado (ACELERATO_BASE_URL/API_EMAIL/API_TOKEN).',
        undefined,
      );
    }
    const basic = Buffer.from(`${this.email}:${this.token}`).toString('base64');
    const http = axios.create({
      baseURL: this.baseURL,
      timeout: this.timeout,
      headers: {
        Authorization: `Basic ${basic}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': 'triagem-api/0.1 (+unifique.com.br)',
      },
      maxContentLength: 5 * 1024 * 1024,
      validateStatus: (s) => s >= 200 && s < 300,
    });
    axiosRetry(http, {
      retries: this.retries,
      retryDelay: axiosRetry.exponentialDelay,
      retryCondition: (err) => {
        const s = err.response?.status;
        return (
          axiosRetry.isNetworkOrIdempotentRequestError(err) ||
          s === 429 ||
          (typeof s === 'number' && s >= 500)
        );
      },
    });
    this.http = http;
    return http;
  }

  async abrirSolicitacao(
    input: AbrirSolicitacaoInput,
  ): Promise<AbrirSolicitacaoResult> {
    const http = this.getHttp();
    if (!this.projetoKey || !this.especieDeTicketKey) {
      throw new AceleratoApiError(
        'Acelerato sem ACELERATO_PROJETO_KEY/ESPECIE_TICKET_KEY configurados.',
        undefined,
      );
    }

    const titulo = `Criar acesso AD — ${input.nomeCompleto}${
      input.vagaTitulo ? ` (${input.vagaTitulo})` : ''
    }`;

    const linhas: string[] = [
      `<p><b>Nome completo:</b> ${escaparHtml(input.nomeCompleto)}</p>`,
      `<p><b>Fonte do nome:</b> ${
        input.fonteNome === 'rg-ocr'
          ? 'RG (extraído por IA — conferir)'
          : 'Cadastro Gupy (RG não lido por IA — conferir)'
      }</p>`,
    ];
    if (input.cpf) linhas.push(`<p><b>CPF:</b> ${escaparHtml(input.cpf)}</p>`);
    if (input.rgNumero)
      linhas.push(
        `<p><b>RG:</b> ${escaparHtml(input.rgNumero)}${
          input.orgaoEmissor ? ` ${escaparHtml(input.orgaoEmissor)}` : ''
        }</p>`,
      );
    if (input.cargo)
      linhas.push(`<p><b>Cargo:</b> ${escaparHtml(input.cargo)}</p>`);
    if (input.vagaTitulo)
      linhas.push(`<p><b>Vaga:</b> ${escaparHtml(input.vagaTitulo)}</p>`);
    if (input.confiancaOcr)
      linhas.push(
        `<p><b>Confiança do OCR:</b> ${escaparHtml(input.confiancaOcr)}</p>`,
      );
    if (input.linkPainel)
      linhas.push(
        `<p><b>Conferir no UniATS:</b> <a href="${escaparHtml(
          input.linkPainel,
        )}">${escaparHtml(input.linkPainel)}</a></p>`,
      );
    linhas.push(
      '<p><i>Dados extraídos automaticamente do documento por IA — confira antes de criar o usuário no AD.</i></p>',
    );

    const payload: Record<string, unknown> = {
      titulo,
      descricao: linhas.join('\n'),
      especieDeTicketKey: this.especieDeTicketKey,
      projeto: { projetoKey: this.projetoKey },
    };
    if (this.tipoDeTicketKey)
      payload.tipoDeTicket = { tipoDeTicketKey: this.tipoDeTicketKey };
    if (this.categoriaKey)
      payload.categoria = { categoriaKey: this.categoriaKey };
    if (this.prioridadeKey)
      payload.tipoDePrioridade = { tipoDePrioridadeKey: this.prioridadeKey };

    let dados: unknown;
    try {
      const resp = await this.limiter.schedule(() =>
        http.post('/api/publica/chamados', payload),
      );
      dados = resp.data;
    } catch (err) {
      const e = err as {
        response?: { status?: number; data?: unknown };
        message?: string;
      };
      const status = e.response?.status;
      this.logger.error(
        `Acelerato falhou ao abrir chamado: status=${status} message=${e.message}`,
      );
      throw new AceleratoApiError(
        'Falha ao abrir chamado no Acelerato.',
        status,
        e.response?.data,
      );
    }

    const parsed = ChamadoCriadoSchema.safeParse(dados);
    const ref = parsed.success
      ? String(parsed.data.ticketKey ?? parsed.data.id ?? '')
      : '';
    const url = parsed.success ? (parsed.data.url ?? null) : null;

    if (!ref) {
      this.logger.warn(
        'Acelerato respondeu sem ticketKey/id reconhecível — gravando resposta bruta.',
      );
    }

    return { refExterna: ref, url, payloadEnviado: payload, resposta: dados };
  }
}
