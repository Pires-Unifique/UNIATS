import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';

import { MeetStreamClient } from '../../meetstream/meetstream.client.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { QUEUE_NAMES } from '../../../queue/queue.module.js';

export interface AgendarEntrevistaInput {
  candidaturaId: string;
  agendadaPara: Date;
  meetUrl: string;
  duracaoEstimadaMin?: number;
  entrevistadorId?: string;
  googleEventId?: string;
}

@Injectable()
export class InterviewService {
  private readonly logger = new Logger(InterviewService.name);
  private readonly publicBaseUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly meetstream: MeetStreamClient,
    private readonly config: ConfigService,
    @InjectQueue(QUEUE_NAMES.BOT_ENTREVISTA)
    private readonly filaBot: Queue,
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
    if (!candidatura.candidato.consentimento_gravacao_em) {
      throw new BadRequestException(
        'Candidato sem consentimento de gravação de voz — entreviste sem bot ou colete consentimento.',
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
      select: { id: true, bot_session_id: true, status: true },
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
}
