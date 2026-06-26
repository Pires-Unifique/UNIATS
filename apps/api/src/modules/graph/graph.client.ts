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
 * Cliente Microsoft Graph (app-only / client credentials).
 *
 * Usado no agendamento de entrevista: cria UM evento na agenda do recrutador que,
 * num único POST, faz TRÊS coisas:
 *   1. cria a reunião online no Teams  (isOnlineMeeting + teamsForBusiness)
 *   2. bloqueia o horário do recrutador (showAs: "busy")
 *   3. convida o candidato por e-mail   (attendee → convite nativo do Outlook)
 *
 * Requer um app registration (Entra ID) com permissões de APLICAÇÃO + admin consent:
 *   - Calendars.ReadWrite
 *   - OnlineMeetings.ReadWrite.All
 * e um client secret (AZURE_AD_CLIENT_SECRET). Sem isso, `enabled` é false e as
 * chamadas lançam 503 — o orquestrador converte em 422 amigável.
 *
 * Token: client_credentials cacheado em memória até ~1 min antes de expirar.
 */

const TokenResponseSchema = z
  .object({
    access_token: z.string().min(1),
    expires_in: z.coerce.number().int().positive(),
  })
  .passthrough();

const EventoResponseSchema = z
  .object({
    id: z.string().min(1),
    onlineMeeting: z
      .object({ joinUrl: z.string().url().optional() })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();

const OnlineMeetingListSchema = z
  .object({
    value: z
      .array(z.object({ id: z.string().min(1) }).passthrough())
      .default([]),
  })
  .passthrough();

const TranscriptListSchema = z
  .object({
    value: z
      .array(
        z
          .object({
            id: z.string().min(1),
            createdDateTime: z.string().optional(),
          })
          .passthrough(),
      )
      .default([]),
  })
  .passthrough();

export interface TranscriptInfo {
  id: string;
  criadoEm?: string;
}

export interface CriarEventoTeamsInput {
  /** UPN/e-mail do recrutador dono da agenda (organizador). */
  organizadorEmail: string;
  inicio: Date;
  fim: Date;
  assunto: string;
  /** Corpo do convite em HTML (mostrado no e-mail/calendário). */
  corpoHtml: string;
  /** Candidato convidado — recebe o convite nativo do Outlook. */
  convidado: { email: string; nome?: string };
  /** Convidados adicionais (ex.: o recrutador, quando o organizador é uma conta de serviço). */
  convidadosExtra?: Array<{ email: string; nome?: string }>;
  /** Gera link Teams (default true). Se false, cria só o bloqueio/convite. */
  teams?: boolean;
}

export interface CriarEventoTeamsResultado {
  eventId: string;
  joinUrl: string | null;
}

@Injectable()
export class GraphClient {
  private readonly logger = new Logger(GraphClient.name);
  private readonly http: AxiosInstance;

  private readonly tenantId: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly scope: string;
  private readonly timezone: string;
  private readonly spokenLanguage: string;

  // Cache do token app-only (em memória do processo).
  private tokenCache: { token: string; expiraEm: number } | null = null;

  private readonly paths = {
    eventos: (email: string) =>
      `/users/${encodeURIComponent(email)}/events`,
    evento: (email: string, eventId: string) =>
      `/users/${encodeURIComponent(email)}/events/${encodeURIComponent(eventId)}`,
    onlineMeetings: (email: string) =>
      `/users/${encodeURIComponent(email)}/onlineMeetings`,
    transcripts: (email: string, meetingId: string) =>
      `/users/${encodeURIComponent(email)}/onlineMeetings/${encodeURIComponent(meetingId)}/transcripts`,
    transcriptContent: (email: string, meetingId: string, transcriptId: string) =>
      `/users/${encodeURIComponent(email)}/onlineMeetings/${encodeURIComponent(meetingId)}/transcripts/${encodeURIComponent(transcriptId)}/content`,
  };

  constructor(private readonly config: ConfigService) {
    this.tenantId = this.config.get<string>('AZURE_AD_TENANT_ID') ?? '';
    this.clientId = this.config.get<string>('AZURE_AD_CLIENT_ID') ?? '';
    this.clientSecret = this.config.get<string>('AZURE_AD_CLIENT_SECRET') ?? '';
    this.scope =
      this.config.get<string>('GRAPH_SCOPE') ??
      'https://graph.microsoft.com/.default';
    this.timezone =
      this.config.get<string>('GRAPH_TIMEZONE') ??
      'E. South America Standard Time';
    // Idioma falado da transcrição/gravação (BCP-47). A transcrição automática via
    // Graph começa em INGLÊS por padrão — meetingSpokenLanguageTag força o idioma.
    this.spokenLanguage =
      this.config.get<string>('GRAPH_SPOKEN_LANGUAGE') ?? 'pt-BR';

    const baseURL =
      this.config.get<string>('GRAPH_BASE_URL') ??
      'https://graph.microsoft.com/v1.0';

    this.http = axios.create({
      baseURL,
      timeout: this.config.get<number>('GRAPH_TIMEOUT_MS') ?? 20_000,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    });

    axiosRetry(this.http, {
      retries: this.config.get<number>('GRAPH_RETRY_MAX') ?? 3,
      retryDelay: axiosRetry.exponentialDelay,
      retryCondition: (error) => {
        const status = error.response?.status;
        if (status === 400 || status === 401 || status === 403 || status === 404)
          return false;
        return (
          axiosRetry.isNetworkOrIdempotentRequestError(error) ||
          status === 429 ||
          (status !== undefined && status >= 500)
        );
      },
    });

    if (!this.enabled) {
      this.logger.warn(
        'Microsoft Graph DESABILITADO (faltam AZURE_AD_TENANT_ID/CLIENT_ID/CLIENT_SECRET) — ' +
          'agendamento automático no Teams indisponível neste ambiente.',
      );
    }
  }

  /** True quando há credenciais app-only suficientes para chamar o Graph. */
  get enabled(): boolean {
    return Boolean(this.tenantId && this.clientId && this.clientSecret);
  }

  /**
   * Extrai o OBJECT ID (Azure AD) do ORGANIZADOR a partir do joinUrl do Teams —
   * ele vem no `?context={"Tid":...,"Oid":...}`. É necessário porque os endpoints
   * app-only de onlineMeetings/transcripts SÓ aceitam o object id no path (com UPN/
   * e-mail devolvem 404 UnknownError vazio), e o app NÃO tem User.Read.All para
   * resolver e-mail→id. Devolve null se o link não tiver o contexto (ex.: link
   * pessoal `meet/...`).
   */
  static extrairOidDoJoinUrl(joinUrl: string): string | null {
    try {
      const ctx = new URL(joinUrl).searchParams.get('context');
      if (!ctx) return null;
      const oid = (JSON.parse(ctx) as { Oid?: string }).Oid;
      return oid ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Cria o evento na agenda do recrutador (reunião Teams + bloqueio + convite ao
   * candidato em um único POST). Devolve o id do evento (p/ cancelar) e o joinUrl.
   */
  async criarEventoComTeams(
    input: CriarEventoTeamsInput,
  ): Promise<CriarEventoTeamsResultado> {
    this.garantirHabilitado();
    this.validarEmail(input.organizadorEmail, 'organizadorEmail');
    this.validarEmail(input.convidado.email, 'convidado.email');
    if (input.fim.getTime() <= input.inicio.getTime()) {
      throw new BadRequestException('fim deve ser depois de inicio.');
    }

    const usarTeams = input.teams !== false;
    const corpo: Record<string, unknown> = {
      subject: input.assunto.slice(0, 255),
      body: { contentType: 'HTML', content: input.corpoHtml },
      // dateTime em UTC + timeZone "UTC": tempo absoluto inequívoco; o Outlook de
      // cada participante converte para o fuso local na exibição.
      start: { dateTime: this.formatarUtc(input.inicio), timeZone: 'UTC' },
      end: { dateTime: this.formatarUtc(input.fim), timeZone: 'UTC' },
      attendees: [
        {
          emailAddress: {
            address: input.convidado.email,
            name: input.convidado.nome ?? input.convidado.email,
          },
          type: 'required',
        },
        ...(input.convidadosExtra ?? []).map((c) => ({
          emailAddress: { address: c.email, name: c.nome ?? c.email },
          type: 'required' as const,
        })),
      ],
      showAs: 'busy',
      isReminderOn: true,
      reminderMinutesBeforeStart: 30,
    };
    if (usarTeams) {
      corpo.isOnlineMeeting = true;
      corpo.onlineMeetingProvider = 'teamsForBusiness';
    }

    const token = await this.obterToken();
    try {
      const resp = await this.http.post(
        this.paths.eventos(input.organizadorEmail),
        corpo,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            // Garante que start/end voltem no fuso que pedimos (consistência).
            Prefer: `outlook.timezone="${this.timezone}"`,
          },
        },
      );
      const parsed = EventoResponseSchema.parse(resp.data);
      const joinUrl = parsed.onlineMeeting?.joinUrl ?? null;
      this.logger.log(
        `Evento Graph criado: id=${parsed.id} teams=${usarTeams} joinUrl=${joinUrl ? 'sim' : 'nao'}`,
      );
      return { eventId: parsed.id, joinUrl };
    } catch (err) {
      throw this.normalizarErro(err, 'criarEventoComTeams');
    }
  }

  /** Remove o evento (usado ao cancelar a entrevista). 404 é tratado como no-op. */
  async removerEvento(
    organizadorEmail: string,
    eventId: string,
  ): Promise<void> {
    this.garantirHabilitado();
    this.validarEmail(organizadorEmail, 'organizadorEmail');
    const token = await this.obterToken();
    try {
      await this.http.delete(this.paths.evento(organizadorEmail, eventId), {
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (err) {
      if (isAxiosError(err) && err.response?.status === 404) return;
      throw this.normalizarErro(err, 'removerEvento');
    }
  }

  /**
   * PRÉ-RESERVA — cria um HOLD tentativo na agenda de UM usuário (recrutador ou
   * participante obrigatório): sem Teams, sem convidados, `showAs: tentative`.
   * Bloqueia o horário na agenda DAQUELA pessoa enquanto o candidato decide, sem
   * notificar ninguém. Devolve o id do evento (p/ remover/promover depois). O bloqueio
   * é sempre na agenda do usuário informado — nunca numa agenda compartilhada.
   */
  async criarEventoTentativo(input: {
    usuarioEmail: string;
    inicio: Date;
    fim: Date;
    assunto: string;
    corpoHtml?: string;
  }): Promise<string> {
    this.garantirHabilitado();
    this.validarEmail(input.usuarioEmail, 'usuarioEmail');
    if (input.fim.getTime() <= input.inicio.getTime()) {
      throw new BadRequestException('fim deve ser depois de inicio.');
    }
    const corpo = {
      subject: input.assunto.slice(0, 255),
      body: { contentType: 'HTML', content: input.corpoHtml ?? '' },
      start: { dateTime: this.formatarUtc(input.inicio), timeZone: 'UTC' },
      end: { dateTime: this.formatarUtc(input.fim), timeZone: 'UTC' },
      showAs: 'tentative',
      isReminderOn: false,
      // Categoria nossa: facilita identificar/limpar holds órfãos depois.
      categories: ['Pré-reserva UniATS'],
    };
    const token = await this.obterToken();
    try {
      const resp = await this.http.post(this.paths.eventos(input.usuarioEmail), corpo, {
        headers: {
          Authorization: `Bearer ${token}`,
          Prefer: `outlook.timezone="${this.timezone}"`,
        },
      });
      const id = (resp.data as { id?: string })?.id;
      if (!id) throw new Error('Graph não devolveu id do evento tentativo.');
      this.logger.log(`Hold tentativo criado: usuario=${input.usuarioEmail} id=${id}`);
      return id;
    } catch (err) {
      throw this.normalizarErro(err, 'criarEventoTentativo');
    }
  }

  /**
   * FREE/BUSY — devolve, por e-mail, os blocos OCUPADOS de cada usuário numa janela
   * (getSchedule). Usado pra só PROPOR horários em que o recrutador está livre. É
   * best-effort: se falhar, devolve {} e o chamador segue sem filtrar.
   */
  async consultarFreeBusy(
    emails: string[],
    inicio: Date,
    fim: Date,
  ): Promise<Record<string, Array<{ inicio?: string; fim?: string }>>> {
    this.garantirHabilitado();
    const alvos = emails.filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
    if (alvos.length === 0) return {};
    const token = await this.obterToken();
    try {
      const resp = await this.http.post(
        `/users/${encodeURIComponent(alvos[0])}/calendar/getSchedule`,
        {
          schedules: alvos,
          startTime: { dateTime: this.formatarUtc(inicio), timeZone: 'UTC' },
          endTime: { dateTime: this.formatarUtc(fim), timeZone: 'UTC' },
          availabilityViewInterval: 30,
        },
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const value =
        (resp.data as { value?: Array<Record<string, unknown>> })?.value ?? [];
      const out: Record<string, Array<{ inicio?: string; fim?: string }>> = {};
      for (const sched of value) {
        const email = String(sched.scheduleId ?? '');
        const itens = ((sched.scheduleItems as Array<Record<string, unknown>>) ?? [])
          .filter((it) => it.status && it.status !== 'free')
          .map((it) => ({
            inicio: (it.start as { dateTime?: string })?.dateTime,
            fim: (it.end as { dateTime?: string })?.dateTime,
          }));
        if (email) out[email] = itens;
      }
      return out;
    } catch (err) {
      this.logger.warn(
        `getSchedule falhou (free/busy best-effort): ${(err as Error).message}`,
      );
      return {};
    }
  }

  /** ----------------------------------------------------------------------
   *  Transcript oficial (PULL — sem callback público; tudo saída p/ o Graph)
   *  Requer OnlineMeetingTranscript.Read.All + Application Access Policy.
   *  --------------------------------------------------------------------- */

  /**
   * Resolve o `onlineMeetingId` a partir do joinUrl do Teams, no contexto do
   * organizador. Devolve null se não encontrar (ex.: policy ausente devolve 403,
   * tratado em normalizarErro). O filtro usa JoinWebUrl eq '<joinUrl>'.
   */
  async resolverOnlineMeetingId(
    organizadorOid: string,
    joinUrl: string,
  ): Promise<string | null> {
    this.garantirHabilitado();
    const token = await this.obterToken();
    try {
      const resp = await this.http.get(
        this.paths.onlineMeetings(organizadorOid),
        {
          headers: { Authorization: `Bearer ${token}` },
          // O Graph exige a string entre aspas simples no $filter.
          params: { $filter: `JoinWebUrl eq '${joinUrl}'` },
        },
      );
      const parsed = OnlineMeetingListSchema.parse(resp.data);
      // Diagnóstico: status 200 + count distingue "policy ok mas URL não casou"
      // (count=0) de "achou" (count>=1).
      this.logger.log(
        `resolverOnlineMeetingId: status=${resp.status} count=${parsed.value.length} ` +
          `user=${organizadorOid}` +
          (parsed.value.length === 0
            ? ` — 200 vazio: JoinWebUrl não casou (provável encoding/contexto do link).`
            : ''),
      );
      return parsed.value[0]?.id ?? null;
    } catch (err) {
      const status = isAxiosError(err) ? err.response?.status : undefined;
      // 403 = ForbiddenByAppAccessPolicy → Application Access Policy não cobre o app
      // para este organizador. 404/UnknownError = reunião não encontrada sob este
      // usuário. Ambos viram "não achou" (best-effort), mas logamos a causa provável.
      if (status === 403) {
        this.logger.warn(
          `resolverOnlineMeetingId: 403 p/ ${organizadorOid} — provável Application ` +
            `Access Policy ausente (app não autorizado a ler reuniões deste usuário).`,
        );
        return null;
      }
      if (status === 404) {
        this.logger.warn(
          `resolverOnlineMeetingId: 404 p/ ${organizadorOid} — onlineMeeting não ` +
            `encontrado (organizador divergente, link inválido ou ainda não indexado).`,
        );
        return null;
      }
      throw this.normalizarErro(err, 'resolverOnlineMeetingId');
    }
  }

  /**
   * Liga gravação + transcrição automáticas no onlineMeeting (PATCH). Deve ser
   * chamado ANTES da reunião começar — se já houver humanos na sala, o Teams
   * ignora o flag. Requer OnlineMeetings.ReadWrite.All. Best-effort.
   */
  async habilitarTranscricaoAutomatica(
    organizadorOid: string,
    meetingId: string,
  ): Promise<void> {
    this.garantirHabilitado();
    const token = await this.obterToken();
    try {
      await this.http.patch(
        `${this.paths.onlineMeetings(organizadorOid)}/${encodeURIComponent(meetingId)}`,
        {
          allowTranscription: true,
          recordAutomatically: true,
          // Força o idioma falado — sem isso a transcrição automática sai em inglês.
          meetingSpokenLanguageTag: this.spokenLanguage,
        },
        { headers: { Authorization: `Bearer ${token}` } },
      );
      this.logger.log(
        `Auto-transcrição habilitada: organizador=${organizadorOid} meeting=${meetingId} ` +
          `idioma=${this.spokenLanguage}`,
      );
    } catch (err) {
      throw this.normalizarErro(err, 'habilitarTranscricaoAutomatica');
    }
  }

  /** Lista os transcripts disponíveis da reunião (vazio enquanto o Teams indexa). */
  async listarTranscripts(
    organizadorOid: string,
    meetingId: string,
  ): Promise<TranscriptInfo[]> {
    this.garantirHabilitado();
    const token = await this.obterToken();
    try {
      const resp = await this.http.get(
        this.paths.transcripts(organizadorOid, meetingId),
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const parsed = TranscriptListSchema.parse(resp.data);
      return parsed.value.map((t) => ({ id: t.id, criadoEm: t.createdDateTime }));
    } catch (err) {
      if (isAxiosError(err) && err.response?.status === 404) return [];
      throw this.normalizarErro(err, 'listarTranscripts');
    }
  }

  /**
   * Baixa o conteúdo do transcript em VTT (texto). Devolve null em 404 (ainda
   * não disponível). O parsing do VTT → segmentos fica fora do client.
   */
  async baixarTranscriptVtt(
    organizadorOid: string,
    meetingId: string,
    transcriptId: string,
  ): Promise<string | null> {
    this.garantirHabilitado();
    const token = await this.obterToken();
    try {
      const resp = await this.http.get<string>(
        this.paths.transcriptContent(organizadorOid, meetingId, transcriptId),
        {
          headers: { Authorization: `Bearer ${token}` },
          params: { $format: 'text/vtt' },
          responseType: 'text',
          transformResponse: [(d) => d as string],
        },
      );
      const vtt = String(resp.data ?? '').trim();
      return vtt.length > 0 ? vtt : null;
    } catch (err) {
      if (isAxiosError(err) && err.response?.status === 404) return null;
      throw this.normalizarErro(err, 'baixarTranscriptVtt');
    }
  }

  /** ----------------------------------------------------------------------
   *  Internos
   *  --------------------------------------------------------------------- */

  private garantirHabilitado(): void {
    if (!this.enabled) {
      throw new ServiceUnavailableException(
        'Microsoft Graph não configurado (AZURE_AD_CLIENT_SECRET ausente).',
      );
    }
  }

  private async obterToken(): Promise<string> {
    const agora = Date.now();
    if (this.tokenCache && this.tokenCache.expiraEm > agora) {
      return this.tokenCache.token;
    }
    const url = `https://login.microsoftonline.com/${encodeURIComponent(this.tenantId)}/oauth2/v2.0/token`;
    const form = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.clientId,
      client_secret: this.clientSecret,
      scope: this.scope,
    });
    try {
      const resp = await axios.post(url, form.toString(), {
        timeout: this.config.get<number>('GRAPH_TIMEOUT_MS') ?? 20_000,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      const parsed = TokenResponseSchema.parse(resp.data);
      // Renova 60s antes de expirar para evitar corrida com a expiração.
      this.tokenCache = {
        token: parsed.access_token,
        expiraEm: agora + (parsed.expires_in - 60) * 1000,
      };
      return parsed.access_token;
    } catch (err) {
      this.tokenCache = null;
      throw this.normalizarErro(err, 'obterToken');
    }
  }

  /** Formata Date → "YYYY-MM-DDTHH:mm:ss" em UTC (sem o 'Z', como o Graph espera). */
  private formatarUtc(d: Date): string {
    return d.toISOString().replace(/\.\d{3}Z$/, '');
  }

  private validarEmail(email: string, campo: string): void {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException(`${campo} inválido: "${email}".`);
    }
  }

  private normalizarErro(err: unknown, op: string): Error {
    if (isAxiosError(err)) {
      const status = err.response?.status;
      this.logger.error(
        `Graph ${op} status=${status} body=${JSON.stringify(err.response?.data ?? err.message).slice(0, 400)}`,
      );
      if (status === 401 || status === 403) {
        return new ServiceUnavailableException(
          `Graph negou autenticação/autorização em ${op} (verifique permissões e admin consent).`,
        );
      }
      if (status === 400 || status === 422) {
        return new BadRequestException(`Graph recusou payload em ${op}.`);
      }
      if (status === 429 || (status && status >= 500)) {
        return new ServiceUnavailableException(
          `Graph indisponível (${status}) em ${op} — tente novamente.`,
        );
      }
    } else {
      this.logger.error(`Graph ${op} erro: ${(err as Error).message}`);
    }
    return new InternalServerErrorException(`Falha em Graph ${op}.`);
  }
}
