import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';

import { GraphClient } from '../../graph/graph.client.js';
import { MeetStreamClient } from '../../meetstream/meetstream.client.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { QUEUE_NAMES } from '../../../queue/queue.module.js';
import { WahaClient } from '../../waha/waha.client.js';
import type { WahaChatId } from '../../waha/waha.types.js';

export interface AgendarEntrevistaInput {
  candidaturaId: string;
  agendadaPara: Date;
  /**
   * Link da reunião. OPCIONAL: se ausente, o sistema gera a sala no Teams (Graph)
   * — convite + bloqueio de agenda + auto-transcrição. Quando informado, é usado
   * como está (precisa ser https).
   */
  meetUrl?: string;
  duracaoEstimadaMin?: number;
  entrevistadorId?: string;
  googleEventId?: string;
  /** Id do evento no Outlook/Graph (p/ remover o bloqueio ao cancelar). */
  graphEventId?: string;
  /** joinUrl do Teams quando o provedor de vídeo for Teams. */
  teamsJoinUrl?: string;
  /** "teams" | "google_meet". */
  provedorVideo?: string;
  /** onlineMeetingId no Graph (resolvido na criação — pull direto, sem redescobrir). */
  graphOnlineMeetingId?: string | null;
  /** Conta organizadora sob a qual o transcript existe no Graph. */
  graphOrganizadorEmail?: string | null;
  /** Registra consentimento de gravação do candidato no ato do agendamento. */
  consentirGravacao?: boolean;
}

export interface ConfirmarPorEnqueteInput {
  enqueteId: string;
  /** Provedor do link de vídeo. Hoje o fluxo automático cobre "teams". */
  provedor?: 'teams';
  duracaoEstimadaMin?: number;
  consentirGravacao?: boolean;
}

@Injectable()
export class InterviewService {
  private readonly logger = new Logger(InterviewService.name);
  private readonly publicBaseUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly meetstream: MeetStreamClient,
    private readonly graph: GraphClient,
    private readonly waha: WahaClient,
    private readonly config: ConfigService,
    @InjectQueue(QUEUE_NAMES.BOT_ENTREVISTA)
    private readonly filaBot: Queue,
    @InjectQueue(QUEUE_NAMES.TRANSCRICAO_GRAPH)
    private readonly filaGraph: Queue,
    @InjectQueue(QUEUE_NAMES.PLAYWRIGHT_JOIN)
    private readonly filaPlaywright: Queue,
  ) {
    this.publicBaseUrl =
      this.config.get<string>('PUBLIC_BASE_URL') ??
      'http://localhost:3001';
  }

  /**
   * Cria a entrevista AGENDADA. NÃO inicia o bot — isso é feito perto do horário
   * (operador clica "iniciar bot" ou cron pega 5min antes).
   */
  async agendar(input: AgendarEntrevistaInput) {
    if (input.agendadaPara.getTime() < Date.now() - 5 * 60_000) {
      throw new BadRequestException('agendadaPara não pode estar no passado.');
    }
    if (input.agendadaPara.getTime() > Date.now() + 90 * 24 * 3600_000) {
      throw new BadRequestException(
        'agendadaPara não pode estar a mais de 90 dias no futuro.',
      );
    }
    // meetUrl é OPCIONAL: ou o recrutador informa o link, ou o sistema gera a sala
    // no Teams (abaixo). Quando informado, exigimos https.
    if (input.meetUrl !== undefined && !/^https:\/\//.test(input.meetUrl)) {
      throw new BadRequestException('meetUrl deve ser HTTPS.');
    }

    const candidatura = await this.prisma.candidatura.findUnique({
      where: { id: input.candidaturaId },
      select: {
        id: true,
        candidato_id: true,
        candidato: {
          select: {
            nome_completo: true,
            email: true,
            consentimento_gravacao_em: true,
            excluido_em: true,
          },
        },
        vaga: {
          select: {
            titulo: true,
            recrutador: { select: { id: true, email: true } },
          },
        },
      },
    });
    if (!candidatura) {
      throw new NotFoundException(
        `Candidatura ${input.candidaturaId} não existe.`,
      );
    }
    if (candidatura.candidato.excluido_em) {
      throw new BadRequestException(
        'Candidato pediu exclusão (LGPD) — não é permitido agendar entrevista.',
      );
    }

    // O agendamento NÃO exige consentimento de gravação — só o BOT de gravação
    // exige (ver iniciarBot / bot-start.processor). Quando o recrutador confirma
    // que o candidato foi informado/aceitou (cláusula do convite), registramos
    // o consentimento aqui para liberar o bot.
    if (
      input.consentirGravacao &&
      !candidatura.candidato.consentimento_gravacao_em
    ) {
      await this.prisma.candidato.update({
        where: { id: candidatura.candidato_id },
        data: { consentimento_gravacao_em: new Date() },
      });
      this.logger.log(
        `Consentimento de gravação registrado no agendamento — candidato=${candidatura.candidato_id}`,
      );
    }

    const duracaoMin = input.duracaoEstimadaMin ?? 30;

    // Campos de vídeo partem do input. O fluxo "link informado" e o da enquete
    // (que gera o Teams ANTES de chamar agendar) já trazem tudo preenchido aqui.
    let meetUrl = input.meetUrl;
    let teamsJoinUrl = input.teamsJoinUrl;
    let provedorVideo = input.provedorVideo;
    let graphEventId = input.graphEventId;
    let graphOnlineMeetingId = input.graphOnlineMeetingId ?? null;
    let graphOrganizadorEmail = input.graphOrganizadorEmail ?? null;
    let entrevistadorId = input.entrevistadorId;
    // Guardado p/ reverter o evento no Graph se a persistência falhar (evita órfão).
    let salaGeradaEventId: string | null = null;

    // SEM link informado → o sistema cria a sala no Teams (Graph).
    if (!meetUrl) {
      if (!candidatura.candidato.email) {
        throw new BadRequestException(
          'Para gerar a sala automaticamente é preciso o e-mail do candidato; ' +
            'caso contrário, informe o meetUrl manualmente.',
        );
      }
      const fim = new Date(input.agendadaPara.getTime() + duracaoMin * 60_000);
      const sala = await this.criarReuniaoTeams({
        candidatoEmail: candidatura.candidato.email,
        candidatoNome: candidatura.candidato.nome_completo,
        vagaTitulo: candidatura.vaga?.titulo ?? null,
        recrutadorEmail: candidatura.vaga?.recrutador?.email ?? null,
        inicio: input.agendadaPara,
        fim,
      });
      meetUrl = sala.joinUrl;
      teamsJoinUrl = sala.joinUrl;
      provedorVideo = 'teams';
      graphEventId = sala.eventId;
      graphOnlineMeetingId = sala.onlineMeetingId;
      graphOrganizadorEmail = sala.organizadorEmail;
      entrevistadorId =
        entrevistadorId ?? candidatura.vaga?.recrutador?.id ?? undefined;
      salaGeradaEventId = sala.eventId;
    }

    let entrevista: { id: string; status: string; agendada_para: Date };
    try {
      entrevista = await this.prisma.entrevista.create({
        data: {
          candidatura_id: input.candidaturaId,
          candidato_id: candidatura.candidato_id,
          entrevistador_id: entrevistadorId,
          agendada_para: input.agendadaPara,
          duracao_estimada_min: duracaoMin,
          meet_url: meetUrl,
          google_event_id: input.googleEventId,
          graph_event_id: graphEventId,
          teams_join_url: teamsJoinUrl,
          provedor_video: provedorVideo,
          graph_online_meeting_id: graphOnlineMeetingId,
          graph_organizador_email: graphOrganizadorEmail,
          status: 'AGENDADA',
        },
        select: {
          id: true,
          status: true,
          agendada_para: true,
        },
      });
    } catch (err) {
      if (salaGeradaEventId && graphOrganizadorEmail) {
        await this.graph
          .removerEvento(graphOrganizadorEmail, salaGeradaEventId)
          .catch((e) =>
            this.logger.warn(
              `Falha ao reverter evento ${salaGeradaEventId} após erro no agendar: ${(e as Error).message}`,
            ),
          );
      }
      throw err;
    }

    this.logger.log(
      `Entrevista agendada: id=${entrevista.id} candidatura=${input.candidaturaId} ` +
        `para=${input.agendadaPara.toISOString()} ` +
        `sala=${salaGeradaEventId ? 'gerada(Teams)' : 'link informado'}`,
    );
    return entrevista;
  }

  /**
   * Cria a reunião no Teams via Graph: evento + bloqueio de agenda + convite
   * nativo ao candidato; resolve o onlineMeetingId e liga a transcrição automática
   * (best-effort). Usado quando o agendamento NÃO recebe um meetUrl pronto.
   * Mesma orquestração do fluxo de enquete (confirmarPorEnquete).
   */
  private async criarReuniaoTeams(args: {
    candidatoEmail: string;
    candidatoNome: string | null;
    vagaTitulo: string | null;
    recrutadorEmail: string | null;
    inicio: Date;
    fim: Date;
  }): Promise<{
    eventId: string;
    joinUrl: string;
    onlineMeetingId: string | null;
    organizadorEmail: string;
  }> {
    if (!this.graph.enabled) {
      throw new ServiceUnavailableException(
        'Geração automática da sala no Teams indisponível: Microsoft Graph não ' +
          'configurado (defina AZURE_AD_CLIENT_SECRET e as permissões de app). ' +
          'Você ainda pode agendar informando o meetUrl manualmente.',
      );
    }
    // Organizador FIXO (conta de serviço) tem prioridade — garante transcript
    // acessível sob um único usuário; senão cai no recrutador / fallback.
    const organizadorFixo = this.config.get<string>('INTERVIEW_ORGANIZER_EMAIL');
    const organizadorEmail =
      organizadorFixo ??
      args.recrutadorEmail ??
      this.config.get<string>('AGENDA_ORGANIZADOR_FALLBACK_EMAIL');
    if (!organizadorEmail) {
      throw new BadRequestException(
        'Sem organizador definido — configure INTERVIEW_ORGANIZER_EMAIL ou vincule ' +
          'um recrutador à vaga (ou AGENDA_ORGANIZADOR_FALLBACK_EMAIL).',
      );
    }
    const convidadosExtra =
      args.recrutadorEmail && args.recrutadorEmail !== organizadorEmail
        ? [{ email: args.recrutadorEmail }]
        : [];
    const titulo = args.vagaTitulo ?? 'Entrevista';
    const nomeCandidato = args.candidatoNome ?? 'candidato(a)';
    const quando = this.formatarDataHora(args.inicio);

    const { eventId, joinUrl } = await this.graph.criarEventoComTeams({
      organizadorEmail,
      inicio: args.inicio,
      fim: args.fim,
      assunto: `Entrevista — ${titulo}`,
      corpoHtml: this.montarCorpoConvite({ nomeCandidato, titulo, quando }),
      convidado: {
        email: args.candidatoEmail,
        nome: args.candidatoNome ?? undefined,
      },
      convidadosExtra,
      teams: true,
    });
    if (!joinUrl) {
      await this.graph
        .removerEvento(organizadorEmail, eventId)
        .catch((err) =>
          this.logger.warn(
            `Falha ao reverter evento ${eventId} sem joinUrl: ${(err as Error).message}`,
          ),
        );
      throw new ServiceUnavailableException(
        'O Graph criou o evento mas não devolveu o link do Teams — tente novamente.',
      );
    }
    let onlineMeetingId: string | null = null;
    try {
      // onlineMeetings/transcripts app-only exigem o OBJECT ID no path (UPN dá 404).
      // O object id do organizador vem no `?context` (Oid) do joinUrl.
      const organizadorOid = GraphClient.extrairOidDoJoinUrl(joinUrl);
      if (organizadorOid) {
        onlineMeetingId = await this.graph.resolverOnlineMeetingId(
          organizadorOid,
          joinUrl,
        );
        if (onlineMeetingId) {
          await this.graph.habilitarTranscricaoAutomatica(
            organizadorOid,
            onlineMeetingId,
          );
        }
      } else {
        this.logger.warn(
          `Auto-transcrição: joinUrl sem Oid p/ evento ${eventId} — seguirá sem PATCH.`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `Falha ao habilitar auto-transcrição (não crítico): ${(err as Error).message}`,
      );
    }
    return { eventId, joinUrl, onlineMeetingId, organizadorEmail };
  }

  /**
   * Confirma a entrevista a partir do horário que o candidato escolheu na enquete
   * de WhatsApp (1 clique do recrutador). Em um único POST ao Graph:
   *   - cria a reunião no Teams (joinUrl),
   *   - bloqueia a agenda do recrutador (organizador),
   *   - convida o candidato por e-mail (convite nativo do Outlook).
   * Depois registra a `Entrevista` e manda um reforço por WhatsApp (best-effort).
   *
   * Idempotente: se a enquete já gerou uma entrevista, devolve a existente.
   */
  async confirmarPorEnquete(input: ConfirmarPorEnqueteInput): Promise<{
    entrevistaId: string;
    joinUrl: string;
    organizadorEmail: string;
    whatsappEnviado: boolean;
    jaExistia: boolean;
  }> {
    const provedor = input.provedor ?? 'teams';

    const enquete = await this.prisma.enqueteHorario.findUnique({
      where: { id: input.enqueteId },
      select: {
        id: true,
        status: true,
        opcao_escolhida: true,
        inicio_escolhido: true,
        fim_escolhido: true,
        candidatura_id: true,
        candidato_id: true,
        entrevista_id: true,
        candidato: {
          select: {
            nome_completo: true,
            email: true,
            telefone: true,
            excluido_em: true,
          },
        },
        candidatura: {
          select: {
            vaga: {
              select: {
                titulo: true,
                recrutador: { select: { id: true, email: true, nome: true } },
              },
            },
          },
        },
      },
    });
    if (!enquete) {
      throw new NotFoundException(`Enquete ${input.enqueteId} não existe.`);
    }

    // Idempotência: enquete já confirmada → devolve a entrevista existente.
    if (enquete.entrevista_id) {
      const existente = await this.prisma.entrevista.findUnique({
        where: { id: enquete.entrevista_id },
        select: { id: true, teams_join_url: true, meet_url: true },
      });
      const organizador =
        enquete.candidatura.vaga?.recrutador?.email ??
        this.config.get<string>('AGENDA_ORGANIZADOR_FALLBACK_EMAIL') ??
        '';
      return {
        entrevistaId: enquete.entrevista_id,
        joinUrl: existente?.teams_join_url ?? existente?.meet_url ?? '',
        organizadorEmail: organizador,
        whatsappEnviado: false,
        jaExistia: true,
      };
    }

    if (
      enquete.status !== 'RESPONDIDA' ||
      !enquete.inicio_escolhido ||
      !enquete.fim_escolhido
    ) {
      throw new BadRequestException(
        'A enquete ainda não tem um horário escolhido pelo candidato.',
      );
    }
    if (enquete.candidato.excluido_em) {
      throw new BadRequestException(
        'Candidato pediu exclusão (LGPD) — não é permitido agendar entrevista.',
      );
    }
    if (!enquete.candidato.email) {
      throw new BadRequestException(
        'Candidato sem e-mail — não é possível enviar o convite de calendário.',
      );
    }

    const recrutadorEmail = enquete.candidatura.vaga?.recrutador?.email ?? null;
    // Organizador FIXO (conta de serviço) tem prioridade: garante que o transcript
    // via Graph seja sempre acessível sob um único usuário. Sem ele, cai no
    // recrutador (comportamento antigo).
    const organizadorFixo = this.config.get<string>('INTERVIEW_ORGANIZER_EMAIL');
    const organizadorEmail =
      organizadorFixo ??
      recrutadorEmail ??
      this.config.get<string>('AGENDA_ORGANIZADOR_FALLBACK_EMAIL');
    if (!organizadorEmail) {
      throw new BadRequestException(
        'Sem organizador definido — configure INTERVIEW_ORGANIZER_EMAIL ou vincule ' +
          'um recrutador à vaga (ou AGENDA_ORGANIZADOR_FALLBACK_EMAIL).',
      );
    }
    // Quando o organizador é a conta de serviço, o recrutador entra como convidado.
    const convidadosExtra =
      recrutadorEmail && recrutadorEmail !== organizadorEmail
        ? [{ email: recrutadorEmail }]
        : [];

    if (provedor === 'teams' && !this.graph.enabled) {
      throw new ServiceUnavailableException(
        'Agendamento automático no Teams indisponível: Microsoft Graph não ' +
          'configurado (defina AZURE_AD_CLIENT_SECRET e as permissões de app).',
      );
    }

    const inicio = enquete.inicio_escolhido;
    const fim = enquete.fim_escolhido;
    // Valida o horário ANTES de criar a reunião no Teams. Se o horário escolhido
    // já passou, não dá para agendar — e criar o evento aqui deixaria reunião
    // órfã + agenda bloqueada, pois o agendar() abaixo rejeitaria depois do POST
    // ao Graph. Mensagem acionável: o recrutador reenvia a enquete.
    if (inicio.getTime() < Date.now() - 5 * 60_000) {
      throw new BadRequestException(
        'O horário escolhido pelo candidato já passou. Envie uma nova enquete de horários.',
      );
    }
    const titulo = enquete.candidatura.vaga?.titulo ?? 'Entrevista';
    const nomeCandidato = enquete.candidato.nome_completo ?? 'candidato(a)';
    const quando = this.formatarDataHora(inicio);
    const assunto = `Entrevista — ${titulo}`;

    // Cria reunião Teams + bloqueio + convite nativo ao candidato (um POST).
    const { eventId, joinUrl } = await this.graph.criarEventoComTeams({
      organizadorEmail,
      inicio,
      fim,
      assunto,
      corpoHtml: this.montarCorpoConvite({
        nomeCandidato,
        titulo,
        quando,
      }),
      convidado: {
        email: enquete.candidato.email,
        nome: enquete.candidato.nome_completo ?? undefined,
      },
      convidadosExtra,
      teams: true,
    });

    if (!joinUrl) {
      // Evento sem link Teams é inútil para o nosso fluxo — desfaz o bloqueio.
      await this.graph
        .removerEvento(organizadorEmail, eventId)
        .catch((err) =>
          this.logger.warn(
            `Falha ao reverter evento ${eventId} sem joinUrl: ${(err as Error).message}`,
          ),
        );
      throw new ServiceUnavailableException(
        'O Graph criou o evento mas não devolveu o link do Teams — tente novamente.',
      );
    }

    // Liga gravação+transcrição automáticas (best-effort): resolve o onlineMeetingId
    // e faz o PATCH ANTES da reunião começar. Falha aqui não impede o agendamento —
    // só significa que a transcrição talvez precise ser iniciada manualmente.
    // Plano B: o id resolvido aqui é persistido na entrevista, pra o pull do
    // transcript usar direto depois (sem redescobrir por JoinWebUrl). Fica null se
    // a policy ainda não propagou — o processor cai no fallback de resolução.
    let onlineMeetingId: string | null = null;
    try {
      // onlineMeetings/transcripts app-only exigem o OBJECT ID no path (UPN dá 404).
      // O object id do organizador vem no `?context` (Oid) do joinUrl.
      const organizadorOid = GraphClient.extrairOidDoJoinUrl(joinUrl);
      if (!organizadorOid) {
        this.logger.warn(
          `Auto-transcrição: joinUrl sem Oid p/ evento ${eventId} — seguirá sem PATCH.`,
        );
      } else {
        onlineMeetingId = await this.graph.resolverOnlineMeetingId(
          organizadorOid,
          joinUrl,
        );
        if (onlineMeetingId) {
          await this.graph.habilitarTranscricaoAutomatica(
            organizadorOid,
            onlineMeetingId,
          );
        } else {
          this.logger.warn(
            `Auto-transcrição: onlineMeetingId ainda não resolvido p/ evento ${eventId} — seguirá sem PATCH.`,
          );
        }
      }
    } catch (err) {
      this.logger.warn(
        `Falha ao habilitar auto-transcrição (não crítico): ${(err as Error).message}`,
      );
    }

    let entrevista: { id: string; status: string; agendada_para: Date };
    try {
      entrevista = await this.agendar({
        candidaturaId: enquete.candidatura_id,
        agendadaPara: inicio,
        meetUrl: joinUrl,
        duracaoEstimadaMin:
          input.duracaoEstimadaMin ??
          Math.max(
            5,
            Math.round((fim.getTime() - inicio.getTime()) / 60_000),
          ),
        entrevistadorId: enquete.candidatura.vaga?.recrutador?.id,
        graphEventId: eventId,
        teamsJoinUrl: joinUrl,
        provedorVideo: 'teams',
        graphOnlineMeetingId: onlineMeetingId,
        graphOrganizadorEmail: organizadorEmail,
        consentirGravacao: input.consentirGravacao,
      });
    } catch (err) {
      // Reverte a reunião/bloqueio criados no Graph para não deixar evento órfão
      // (a validação de horário acima já cobre o caso comum; isto blinda os demais).
      await this.graph
        .removerEvento(organizadorEmail, eventId)
        .catch((e) =>
          this.logger.warn(
            `Falha ao reverter evento ${eventId} após erro no agendar: ${(e as Error).message}`,
          ),
        );
      throw err;
    }

    // Vincula a enquete à entrevista (trava idempotência).
    await this.prisma.enqueteHorario.update({
      where: { id: enquete.id },
      data: { entrevista_id: entrevista.id },
    });

    // Reforço por WhatsApp (best-effort — o convite por e-mail já saiu pelo Graph).
    let whatsappEnviado = false;
    const telefone = enquete.candidato.telefone;
    if (telefone) {
      try {
        const check = await this.waha.checkNumber(telefone);
        if (check.numberExists && check.chatId) {
          const texto =
            `✅ Sua entrevista para *${titulo}* está confirmada!\n\n` +
            `🗓️ *${quando}*\n` +
            `💻 Link do Teams: ${joinUrl}\n\n` +
            'Você também recebeu o convite no e-mail (pode aceitar por lá). Até breve!';
          await this.waha.sendText({
            chatId: check.chatId as WahaChatId,
            texto,
            linkPreview: false,
          });
          await this.prisma.mensagem.create({
            data: {
              candidatura_id: enquete.candidatura_id,
              candidato_id: enquete.candidato_id,
              canal: 'WHATSAPP',
              direcao: 'SAIDA',
              template_codigo: 'confirmacao_entrevista',
              corpo: texto,
              destino: check.chatId,
              provider: 'waha',
              status: 'ENVIADO',
              enviado_em: new Date(),
            },
          });
          whatsappEnviado = true;
        }
      } catch (err) {
        this.logger.warn(
          `Falha ao enviar confirmação por WhatsApp (não crítico): ${(err as Error).message}`,
        );
      }
    }

    this.logger.log(
      `Entrevista confirmada via enquete ${enquete.id}: entrevista=${entrevista.id} ` +
        `organizador=${organizadorEmail} whatsapp=${whatsappEnviado}`,
    );
    return {
      entrevistaId: entrevista.id,
      joinUrl,
      organizadorEmail,
      whatsappEnviado,
      jaExistia: false,
    };
  }

  /** Formata a data/hora no fuso de Brasília para mensagens/convite. */
  private formatarDataHora(d: Date): string {
    return new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'full',
      timeStyle: 'short',
      timeZone: 'America/Sao_Paulo',
    }).format(d);
  }

  /** Corpo HTML do convite de calendário (mostrado no e-mail e no evento). */
  private montarCorpoConvite(args: {
    nomeCandidato: string;
    titulo: string;
    quando: string;
  }): string {
    return (
      `<p>Olá, ${args.nomeCandidato}!</p>` +
      `<p>Sua entrevista para a vaga <strong>${args.titulo}</strong> está confirmada.</p>` +
      `<p><strong>Quando:</strong> ${args.quando}</p>` +
      '<p>O link da reunião do Teams está neste convite. ' +
      'Basta clicar em <em>Ingressar</em> no horário combinado.</p>' +
      '<p>Qualquer imprevisto, responda este convite ou fale com o time de recrutamento.</p>' +
      '<p>Unifique — Recrutamento</p>'
    );
  }

  /**
   * Enfileira o bot. Idempotente — se já há `bot_session_id`, retorna sem refazer.
   */
  async iniciarBot(entrevistaId: string): Promise<{ entrevistaId: string; status: string }> {
    const entrevista = await this.prisma.entrevista.findUnique({
      where: { id: entrevistaId },
      select: {
        id: true,
        meet_url: true,
        status: true,
        bot_session_id: true,
        candidato: { select: { consentimento_gravacao_em: true, excluido_em: true } },
      },
    });
    if (!entrevista) {
      throw new NotFoundException(`Entrevista ${entrevistaId} não existe.`);
    }
    if (!entrevista.meet_url) {
      throw new BadRequestException('Entrevista sem meetUrl.');
    }
    if (entrevista.candidato.excluido_em) {
      throw new BadRequestException(
        'Candidato pediu exclusão (LGPD) — bot não pode entrar.',
      );
    }
    if (!entrevista.candidato.consentimento_gravacao_em) {
      throw new BadRequestException(
        'Candidato sem consentimento de gravação — bot não pode entrar.',
      );
    }
    if (entrevista.bot_session_id) {
      return { entrevistaId, status: 'ja-iniciada' };
    }
    if (entrevista.status === 'CANCELADA' || entrevista.status === 'FINALIZADA') {
      throw new BadRequestException(
        `Entrevista em status ${entrevista.status} — não é possível iniciar bot.`,
      );
    }

    await this.filaBot.add(
      'iniciar-bot',
      { entrevistaId },
      { jobId: `bot-start-${entrevistaId}` },
    );
    return { entrevistaId, status: 'enfileirado' };
  }

  /**
   * Enfileira a busca do transcript OFICIAL do Teams via Graph (pull). Idempotente.
   * Re-tenta por ~36 min enquanto o Teams indexa o transcript (~12 min de espera).
   * Não coloca bot na sala — só baixa o transcript que o Teams já gerou.
   */
  async transcreverViaGraph(
    entrevistaId: string,
  ): Promise<{ entrevistaId: string; status: string }> {
    const entrevista = await this.prisma.entrevista.findUnique({
      where: { id: entrevistaId },
      select: { id: true, teams_join_url: true, meet_url: true },
    });
    if (!entrevista) {
      throw new NotFoundException(`Entrevista ${entrevistaId} não existe.`);
    }
    if (!this.graph.enabled) {
      throw new ServiceUnavailableException('Microsoft Graph não configurado.');
    }
    if (!entrevista.teams_join_url && !entrevista.meet_url) {
      throw new BadRequestException('Entrevista sem joinUrl do Teams.');
    }
    // Remove qualquer job anterior (mesmo failed/completed) para garantir um run
    // FRESCO — senão o BullMQ faz dedup pelo jobId e o disparo manual vira no-op.
    const jobId = `graph-transcript-${entrevistaId}`;
    await this.filaGraph.remove(jobId).catch(() => undefined);
    await this.filaGraph.add(
      'transcrever-graph',
      { entrevistaId },
      {
        jobId,
        attempts: 12,
        backoff: { type: 'fixed', delay: 180_000 }, // re-tenta a cada 3 min (~36 min)
      },
    );
    return { entrevistaId, status: 'enfileirado' };
  }

  /**
   * Dispara o bot Playwright (fallback) para entrar na reunião AGORA e capturar
   * as legendas. Útil pra testar sem esperar o cron de auto-join. O serviço
   * externo playwright-bot consome o job; o resultado volta pelo callback interno.
   */
  async transcreverViaPlaywright(
    entrevistaId: string,
  ): Promise<{ entrevistaId: string; status: string }> {
    const entrevista = await this.prisma.entrevista.findUnique({
      where: { id: entrevistaId },
      select: { id: true, teams_join_url: true, duracao_estimada_min: true },
    });
    if (!entrevista) {
      throw new NotFoundException(`Entrevista ${entrevistaId} não existe.`);
    }
    if (!entrevista.teams_join_url) {
      throw new BadRequestException('Entrevista sem joinUrl do Teams.');
    }
    const maxDuracaoMin =
      this.config.get<number>('PLAYWRIGHT_MAX_DURACAO_MIN') ?? 180;
    const jobId = `playwright-join-${entrevistaId}`;
    await this.filaPlaywright.remove(jobId).catch(() => undefined);
    await this.filaPlaywright.add(
      'join',
      {
        entrevistaId,
        joinUrl: entrevista.teams_join_url,
        maxDuracaoMin: Math.min(
          maxDuracaoMin,
          (entrevista.duracao_estimada_min ?? 30) + 30,
        ),
      },
      { jobId, attempts: 2, backoff: { type: 'fixed', delay: 30_000 } },
    );
    await this.prisma.entrevista.update({
      where: { id: entrevistaId },
      data: { bot_session_id: jobId, bot_provider: 'playwright', bot_status: 'dispatched' },
    });
    return { entrevistaId, status: 'enfileirado' };
  }

  async encerrarBot(entrevistaId: string): Promise<{ ok: boolean }> {
    const entrevista = await this.prisma.entrevista.findUnique({
      where: { id: entrevistaId },
      select: { id: true, bot_session_id: true },
    });
    if (!entrevista) {
      throw new NotFoundException(`Entrevista ${entrevistaId} não existe.`);
    }
    if (!entrevista.bot_session_id) {
      return { ok: false }; // nada a fazer
    }
    await this.meetstream.pararBot(entrevista.bot_session_id);
    return { ok: true };
  }

  async cancelar(entrevistaId: string, motivo?: string): Promise<void> {
    const e = await this.prisma.entrevista.findUnique({
      where: { id: entrevistaId },
      select: {
        id: true,
        bot_session_id: true,
        status: true,
        graph_event_id: true,
        candidatura: {
          select: {
            vaga: { select: { recrutador: { select: { email: true } } } },
          },
        },
      },
    });
    if (!e) throw new NotFoundException(`Entrevista ${entrevistaId} não existe.`);
    if (e.status === 'FINALIZADA') {
      throw new BadRequestException(
        'Entrevista FINALIZADA não pode ser cancelada.',
      );
    }
    if (e.bot_session_id) {
      try {
        await this.meetstream.pararBot(e.bot_session_id);
      } catch (err) {
        this.logger.warn(
          `Falha ao parar bot ${e.bot_session_id}: ${(err as Error).message}`,
        );
      }
    }
    // Remove o bloqueio/reunião no Outlook (cancela o convite do candidato também).
    if (e.graph_event_id && this.graph.enabled) {
      const organizador =
        e.candidatura.vaga?.recrutador?.email ??
        this.config.get<string>('AGENDA_ORGANIZADOR_FALLBACK_EMAIL');
      if (organizador) {
        try {
          await this.graph.removerEvento(organizador, e.graph_event_id);
        } catch (err) {
          this.logger.warn(
            `Falha ao remover evento Graph ${e.graph_event_id}: ${(err as Error).message}`,
          );
        }
      }
    }
    await this.prisma.entrevista.update({
      where: { id: entrevistaId },
      data: {
        status: 'CANCELADA',
        parecer_final: motivo
          ? `Cancelada: ${motivo.slice(0, 500)}`
          : 'Cancelada',
      },
    });
  }

  async obter(entrevistaId: string) {
    const e = await this.prisma.entrevista.findUnique({
      where: { id: entrevistaId },
      include: {
        transcricao: {
          select: {
            id: true,
            idioma: true,
            texto_completo: true,
            resumo: true,
            topicos: true,
            criado_em: true,
          },
        },
        analise_voz: {
          select: {
            sentimento_global: true,
            confianca_media: true,
            nervosismo_medio: true,
            entusiasmo_medio: true,
            hesitacao_count: true,
            observacoes_llm: true,
            criado_em: true,
          },
        },
      },
    });
    if (!e) throw new NotFoundException(`Entrevista ${entrevistaId} não existe.`);
    // NUNCA retorna audio_url cru ao recrutador — só metadata. O áudio é
    // acessível via endpoint dedicado com auditoria.
    const { audio_url, ...resto } = e;
    return resto;
  }

  async listarPorCandidatura(candidaturaId: string) {
    return this.prisma.entrevista.findMany({
      where: { candidatura_id: candidaturaId },
      orderBy: { agendada_para: 'desc' },
      take: 50,
      select: {
        id: true,
        agendada_para: true,
        duracao_estimada_min: true,
        status: true,
        bot_status: true,
        iniciada_em: true,
        finalizada_em: true,
        meet_url: true,
      },
    });
  }

  /**
   * Agenda de entrevistas — alimenta a página "Agenda". Por padrão lista as
   * AGENDADAS (próximas, ordem crescente); sem filtro de status lista todas em
   * ordem decrescente. `gestorId` escopa às vagas daquele gestor (null = todas,
   * usado por admin/recrutamento).
   */
  async listarAgenda(status?: string, gestorId?: string | null) {
    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (gestorId) where.candidatura = { vaga: { gestor_id: gestorId } };
    return this.prisma.entrevista.findMany({
      where,
      orderBy: { agendada_para: status === 'AGENDADA' ? 'asc' : 'desc' },
      take: 200,
      select: {
        id: true,
        agendada_para: true,
        duracao_estimada_min: true,
        status: true,
        bot_status: true,
        meet_url: true,
        candidatura: {
          select: {
            id: true,
            vaga: { select: { titulo: true } },
          },
        },
        candidato: { select: { nome_completo: true } },
        entrevistador: { select: { nome: true } },
      },
    });
  }
}
