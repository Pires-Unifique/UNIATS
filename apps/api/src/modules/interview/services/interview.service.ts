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
  meetUrl: string;
  duracaoEstimadaMin?: number;
  entrevistadorId?: string;
  googleEventId?: string;
  /** Id do evento no Outlook/Graph (p/ remover o bloqueio ao cancelar). */
  graphEventId?: string;
  /** joinUrl do Teams quando o provedor de vídeo for Teams. */
  teamsJoinUrl?: string;
  /** "teams" | "google_meet". */
  provedorVideo?: string;
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
    if (!/^https:\/\//.test(input.meetUrl)) {
      throw new BadRequestException('meetUrl deve ser HTTPS.');
    }

    const candidatura = await this.prisma.candidatura.findUnique({
      where: { id: input.candidaturaId },
      select: {
        id: true,
        candidato_id: true,
        candidato: {
          select: {
            consentimento_gravacao_em: true,
            excluido_em: true,
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

    const entrevista = await this.prisma.entrevista.create({
      data: {
        candidatura_id: input.candidaturaId,
        candidato_id: candidatura.candidato_id,
        entrevistador_id: input.entrevistadorId,
        agendada_para: input.agendadaPara,
        duracao_estimada_min: input.duracaoEstimadaMin ?? 30,
        meet_url: input.meetUrl,
        google_event_id: input.googleEventId,
        graph_event_id: input.graphEventId,
        teams_join_url: input.teamsJoinUrl,
        provedor_video: input.provedorVideo,
        status: 'AGENDADA',
      },
      select: {
        id: true,
        status: true,
        agendada_para: true,
      },
    });

    this.logger.log(
      `Entrevista agendada: id=${entrevista.id} candidatura=${input.candidaturaId} para=${input.agendadaPara.toISOString()}`,
    );
    return entrevista;
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

    const organizadorEmail =
      enquete.candidatura.vaga?.recrutador?.email ??
      this.config.get<string>('AGENDA_ORGANIZADOR_FALLBACK_EMAIL');
    if (!organizadorEmail) {
      throw new BadRequestException(
        'Vaga sem recrutador vinculado e sem AGENDA_ORGANIZADOR_FALLBACK_EMAIL — ' +
          'defina o organizador da reunião.',
      );
    }

    if (provedor === 'teams' && !this.graph.enabled) {
      throw new ServiceUnavailableException(
        'Agendamento automático no Teams indisponível: Microsoft Graph não ' +
          'configurado (defina AZURE_AD_CLIENT_SECRET e as permissões de app).',
      );
    }

    const inicio = enquete.inicio_escolhido;
    const fim = enquete.fim_escolhido;
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

    const entrevista = await this.agendar({
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
      consentirGravacao: input.consentirGravacao,
    });

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
    await this.filaGraph.add(
      'transcrever-graph',
      { entrevistaId },
      {
        jobId: `graph-transcript-${entrevistaId}`,
        attempts: 12,
        backoff: { type: 'fixed', delay: 180_000 }, // re-tenta a cada 3 min (~36 min)
      },
    );
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
   * Agenda geral de entrevistas (todas as candidaturas) — alimenta a página
   * "Entrevistas". Por padrão lista as AGENDADAS (próximas, ordem crescente);
   * sem filtro de status lista todas em ordem decrescente.
   */
  async listarAgenda(status?: string) {
    return this.prisma.entrevista.findMany({
      where: status ? { status: status as never } : undefined,
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
