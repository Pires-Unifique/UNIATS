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
import { setTimeout as sleep } from 'node:timers/promises';

import type {
  CheckNumberResult,
  EnviarMidiaInput,
  EnviarResultado,
  EnviarTextoInput,
  WahaChatId,
} from './waha.types.js';

/**
 * Cliente WAHA (https://waha.devlike.pro).
 *
 * WAHA é um wrapper HTTP sobre WhatsApp Web — não é a API oficial Meta.
 * O número PRECISA estar pareado via QR no dashboard antes de enviar.
 *
 * Notas de segurança:
 *  - WAHA não usa criptografia adicional do payload — proteja o ambiente (mTLS/VPN).
 *  - X-Api-Key é segredo simétrico — gire periodicamente.
 *  - Em produção, NUNCA exponha a porta 3000 do WAHA publicamente; rode atrás de proxy interno.
 */
@Injectable()
export class WahaClient {
  private readonly logger = new Logger(WahaClient.name);
  private readonly http: AxiosInstance | null;
  private readonly session: string;
  private readonly typingMs: number;

  constructor(private readonly config: ConfigService) {
    const baseURL = this.config.get<string>('WAHA_BASE_URL');
    const apiKey = this.config.get<string>('WAHA_API_KEY');
    this.session = this.config.get<string>('WAHA_SESSION') ?? 'default';
    this.typingMs = this.config.get<number>('WAHA_TYPING_MS') ?? 1500;

    if (!apiKey || !baseURL) {
      // MVP sem WhatsApp: cliente inerte; envios falham com 503.
      this.logger.warn(
        'WAHA_API_KEY/WAHA_BASE_URL ausente — envio por WhatsApp DESABILITADO neste ambiente.',
      );
      this.http = null;
      return;
    }

    this.http = axios.create({
      baseURL,
      timeout: this.config.getOrThrow<number>('WAHA_TIMEOUT_MS'),
      headers: {
        'X-Api-Key': apiKey,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    });

    axiosRetry(this.http, {
      retries: this.config.getOrThrow<number>('WAHA_RETRY_MAX'),
      retryDelay: axiosRetry.exponentialDelay,
      retryCondition: (error) => {
        const status = error.response?.status;
        // 422 do WAHA é validação — não retentar
        if (status === 422 || status === 400) return false;
        return (
          axiosRetry.isNetworkOrIdempotentRequestError(error) ||
          status === 429 ||
          (status !== undefined && status >= 500)
        );
      },
    });
  }

  /**
   * Verifica se um número existe no WhatsApp e devolve o `chatId` canônico.
   *
   * No Brasil, números registrados antes de 2012 não usam o "9" extra que a
   * Anatel impôs — usar o chatId errado faz a mensagem ir pro vácuo. Este
   * endpoint resolve a forma certa.
   */
  async checkNumber(numeroE164: string): Promise<CheckNumberResult> {
    const phone = this.normalizarTelefone(numeroE164);
    try {
      const resp = await this.client.get('/api/checkNumberStatus', {
        params: { phone, session: this.session },
      });
      const data = resp.data as {
        numberExists?: boolean;
        chatId?: string;
      };
      return {
        numberExists: Boolean(data.numberExists),
        chatId: data.chatId as WahaChatId | undefined,
      };
    } catch (err) {
      throw this.normalizarErro(err, 'checkNumberStatus');
    }
  }

  /**
   * Envia texto. Antes do envio, simula "digitando..." para parecer humano —
   * humanização é uma das mitigações para evitar banimento (vide docs WAHA).
   */
  async sendText(input: EnviarTextoInput): Promise<EnviarResultado> {
    this.validarChatId(input.chatId);

    await this.simularDigitando(input.chatId);

    try {
      const resp = await this.client.post('/api/sendText', {
        session: this.session,
        chatId: input.chatId,
        text: input.texto,
        linkPreview: input.linkPreview ?? false,
        reply_to: input.replyTo,
      });
      return this.extrairResultado(resp.data);
    } catch (err) {
      throw this.normalizarErro(err, 'sendText');
    }
  }

  /** Envia documento (PDF da carta-proposta, por exemplo). */
  async sendFile(input: EnviarMidiaInput): Promise<EnviarResultado> {
    this.validarChatId(input.chatId);
    this.validarArquivoUrl(input.arquivo);

    try {
      const resp = await this.client.post('/api/sendFile', {
        session: this.session,
        chatId: input.chatId,
        file: this.formatarArquivo(input.arquivo, input.nomeArquivo),
        caption: input.legenda,
      });
      return this.extrairResultado(resp.data);
    } catch (err) {
      throw this.normalizarErro(err, 'sendFile');
    }
  }

  /** Envia imagem (ex.: cartaz de programa de estágio). */
  async sendImage(input: EnviarMidiaInput): Promise<EnviarResultado> {
    this.validarChatId(input.chatId);
    this.validarArquivoUrl(input.arquivo);

    try {
      const resp = await this.client.post('/api/sendImage', {
        session: this.session,
        chatId: input.chatId,
        file: this.formatarArquivo(input.arquivo),
        caption: input.legenda,
      });
      return this.extrairResultado(resp.data);
    } catch (err) {
      throw this.normalizarErro(err, 'sendImage');
    }
  }

  /** Envia áudio (OGG/MP3) como nota de voz. */
  async sendVoice(input: EnviarMidiaInput): Promise<EnviarResultado> {
    this.validarChatId(input.chatId);
    this.validarArquivoUrl(input.arquivo);

    try {
      const resp = await this.client.post('/api/sendVoice', {
        session: this.session,
        chatId: input.chatId,
        file: this.formatarArquivo(input.arquivo),
      });
      return this.extrairResultado(resp.data);
    } catch (err) {
      throw this.normalizarErro(err, 'sendVoice');
    }
  }

  /** Marca como lidas as mensagens de um chat (boa cidadania WhatsApp). */
  async sendSeen(chatId: WahaChatId): Promise<void> {
    this.validarChatId(chatId);
    try {
      await this.client.post('/api/sendSeen', {
        session: this.session,
        chatId,
      });
    } catch (err) {
      // sendSeen não é crítico — não bloqueia o fluxo.
      this.logger.warn(
        `sendSeen falhou (não crítico): ${(err as Error).message}`,
      );
    }
  }

  /** ----------------------------------------------------------------------
   *  Internos
   *  --------------------------------------------------------------------- */

  /** Acesso ao http garantindo que o WAHA está configurado (senão 503). */
  private get client(): AxiosInstance {
    if (!this.http) {
      throw new ServiceUnavailableException(
        'WAHA não configurado (WAHA_API_KEY ausente) — WhatsApp desabilitado no MVP.',
      );
    }
    return this.http;
  }

  /**
   * Simula "está digitando..." → espera N ms → "parou de digitar".
   * Mantemos esse delay short (~1.5s default) e não-bloqueante em loops.
   */
  private async simularDigitando(chatId: WahaChatId): Promise<void> {
    if (this.typingMs <= 0) return;
    try {
      await this.client.post('/api/startTyping', {
        session: this.session,
        chatId,
      });
      await sleep(this.typingMs);
      await this.client.post('/api/stopTyping', {
        session: this.session,
        chatId,
      });
    } catch (err) {
      // Tudo isso é cosmético — não falhamos o envio se "typing" der erro.
      this.logger.debug(
        `Simulação de digitação falhou: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Aceita E.164 (+5511999998888) ou apenas dígitos; sempre devolve dígitos.
   * Esse formato é o esperado pelo `checkNumberStatus`.
   */
  private normalizarTelefone(raw: string): string {
    const digits = (raw ?? '').replace(/\D+/g, '');
    if (digits.length < 10 || digits.length > 15) {
      throw new BadRequestException(
        `Telefone inválido (esperado 10-15 dígitos): "${raw}"`,
      );
    }
    return digits;
  }

  private validarChatId(chatId: string): void {
    if (
      !/^[0-9]{8,18}@c\.us$/.test(chatId) &&
      // LID (LinkedID): identificador novo do WhatsApp devolvido pelo
      // checkNumberStatus para parte dos números. WAHA aceita enviar para ele.
      !/^[0-9]{8,20}@lid$/.test(chatId) &&
      !/^[0-9]+(-[0-9]+)?@g\.us$/.test(chatId) &&
      !chatId.endsWith('@newsletter')
    ) {
      throw new BadRequestException(
        `chatId inválido: "${chatId}". Esperado <numero>@c.us, <id>@lid, <id>@g.us ou <id>@newsletter.`,
      );
    }
  }

  private validarArquivoUrl(
    arquivo: EnviarMidiaInput['arquivo'],
  ): void {
    if ('url' in arquivo) {
      // SSRF guard básico — só HTTPS, sem hosts internos.
      if (!arquivo.url.startsWith('https://')) {
        throw new BadRequestException(
          'URL de mídia deve ser HTTPS (proteção SSRF).',
        );
      }
      const hostnameMatch = arquivo.url.match(/^https:\/\/([^\/]+)/);
      const host = hostnameMatch?.[1] ?? '';
      if (
        /^(localhost|127\.|10\.|192\.168\.|169\.254\.|::1)/.test(host) ||
        /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host)
      ) {
        throw new BadRequestException(
          'URL de mídia aponta para host interno — bloqueado.',
        );
      }
    } else {
      // base64 inline — limita tamanho defensivamente (10 MB já em base64 ≈ 14 MB).
      if (arquivo.dataBase64.length > 20_000_000) {
        throw new BadRequestException(
          'Arquivo inline acima do limite (20 MB base64).',
        );
      }
    }
  }

  private formatarArquivo(
    arquivo: EnviarMidiaInput['arquivo'],
    filename?: string,
  ): Record<string, unknown> {
    if ('url' in arquivo) {
      return { url: arquivo.url, filename };
    }
    return {
      mimetype: arquivo.mimeType,
      filename,
      data: arquivo.dataBase64,
    };
  }

  private extrairResultado(data: unknown): EnviarResultado {
    const obj = (data ?? {}) as Record<string, unknown>;
    const messageId =
      (obj.id as { _serialized?: string } | undefined)?._serialized ??
      (typeof obj.id === 'string' ? (obj.id as string) : undefined) ??
      (obj.messageId as string | undefined);

    if (!messageId) {
      this.logger.warn(
        `WAHA não devolveu messageId reconhecível: ${JSON.stringify(obj).slice(0, 200)}`,
      );
      throw new InternalServerErrorException(
        'Resposta WAHA sem messageId.',
      );
    }
    const ts = Number(obj.timestamp ?? Date.now());
    return { messageId, timestamp: ts };
  }

  private normalizarErro(err: unknown, op: string): Error {
    if (isAxiosError(err)) {
      const status = err.response?.status;
      this.logger.error(
        `WAHA ${op} status=${status} body=${JSON.stringify(err.response?.data ?? err.message).slice(0, 500)}`,
      );
      if (status === 422 || status === 400) {
        return new BadRequestException(
          `WAHA recusou payload em ${op}: ${this.extrairMensagemErro(err)}`,
        );
      }
      if (status === 429 || (status && status >= 500)) {
        return new ServiceUnavailableException(
          `WAHA indisponível (${status}) — job será re-tentado.`,
        );
      }
    } else {
      this.logger.error(`WAHA ${op} erro inesperado: ${(err as Error).message}`);
    }
    return new InternalServerErrorException(`Falha em WAHA ${op}.`);
  }

  private extrairMensagemErro(err: ReturnType<typeof isAxiosError> extends true ? never : any): string {
    const data = (err as any)?.response?.data;
    if (typeof data === 'string') return data.slice(0, 200);
    if (data && typeof data === 'object') {
      const msg = (data.message ?? data.error ?? '') as unknown;
      if (Array.isArray(msg)) return msg.join('; ').slice(0, 200);
      if (typeof msg === 'string') return msg.slice(0, 200);
    }
    return 'erro desconhecido';
  }
}
