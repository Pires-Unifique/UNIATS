import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

import { InterviewService } from './services/interview.service.js';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface AgendarBody {
  candidaturaId: string;
  agendadaPara: string; // ISO-8601
  meetUrl: string;
  duracaoEstimadaMin?: number;
  entrevistadorId?: string;
  googleEventId?: string;
  consentirGravacao?: boolean;
}

interface ConfirmarEnqueteBody {
  enqueteId: string;
  provedor?: 'teams';
  duracaoEstimadaMin?: number;
  consentirGravacao?: boolean;
}

@Controller('api/entrevistas')
@UseGuards(ThrottlerGuard)
export class InterviewController {
  constructor(private readonly service: InterviewService) {}

  @Post()
  async agendar(@Body() body: AgendarBody) {
    if (!body || typeof body !== 'object') {
      throw new BadRequestException('Body inválido.');
    }
    if (!UUID_REGEX.test(body.candidaturaId ?? '')) {
      throw new BadRequestException('candidaturaId deve ser UUID.');
    }
    if (body.entrevistadorId && !UUID_REGEX.test(body.entrevistadorId)) {
      throw new BadRequestException('entrevistadorId deve ser UUID.');
    }
    const d = new Date(body.agendadaPara);
    if (Number.isNaN(d.getTime())) {
      throw new BadRequestException('agendadaPara deve ser ISO-8601.');
    }
    if (
      body.duracaoEstimadaMin != null &&
      (body.duracaoEstimadaMin < 5 || body.duracaoEstimadaMin > 240)
    ) {
      throw new BadRequestException(
        'duracaoEstimadaMin deve estar entre 5 e 240.',
      );
    }
    return this.service.agendar({
      candidaturaId: body.candidaturaId,
      agendadaPara: d,
      meetUrl: body.meetUrl,
      duracaoEstimadaMin: body.duracaoEstimadaMin,
      entrevistadorId: body.entrevistadorId,
      googleEventId: body.googleEventId,
      consentirGravacao: body.consentirGravacao,
    });
  }

  /**
   * Confirma a entrevista a partir do horário escolhido pelo candidato na enquete
   * (1 clique do recrutador): cria reunião Teams + bloqueia agenda + convida por
   * e-mail (Outlook) e reforça por WhatsApp.
   */
  @Post('confirmar-enquete')
  async confirmarEnquete(@Body() body: ConfirmarEnqueteBody) {
    if (!body || typeof body !== 'object') {
      throw new BadRequestException('Body inválido.');
    }
    if (!UUID_REGEX.test(body.enqueteId ?? '')) {
      throw new BadRequestException('enqueteId deve ser UUID.');
    }
    if (body.provedor && body.provedor !== 'teams') {
      throw new BadRequestException(
        'provedor inválido — o fluxo automático suporta apenas "teams".',
      );
    }
    if (
      body.duracaoEstimadaMin != null &&
      (body.duracaoEstimadaMin < 5 || body.duracaoEstimadaMin > 240)
    ) {
      throw new BadRequestException(
        'duracaoEstimadaMin deve estar entre 5 e 240.',
      );
    }
    return this.service.confirmarPorEnquete({
      enqueteId: body.enqueteId,
      provedor: body.provedor,
      duracaoEstimadaMin: body.duracaoEstimadaMin,
      consentirGravacao: body.consentirGravacao,
    });
  }

  @Get(':id')
  async obter(@Param('id') id: string) {
    if (!UUID_REGEX.test(id)) {
      throw new BadRequestException('id deve ser UUID.');
    }
    return this.service.obter(id);
  }

  @Get()
  async listar(
    @Query('candidaturaId') candidaturaId?: string,
    @Query('status') status?: string,
  ) {
    // Com candidaturaId: histórico daquela candidatura (uso no detalhe do
    // candidato). Sem candidaturaId: agenda geral de entrevistas.
    if (candidaturaId) {
      if (!UUID_REGEX.test(candidaturaId)) {
        throw new BadRequestException('candidaturaId deve ser UUID.');
      }
      return this.service.listarPorCandidatura(candidaturaId);
    }
    const STATUS_VALIDOS = [
      'AGENDADA',
      'EM_ANDAMENTO',
      'FINALIZADA',
      'CANCELADA',
    ];
    if (status && !STATUS_VALIDOS.includes(status)) {
      throw new BadRequestException('status inválido.');
    }
    return this.service.listarAgenda(status);
  }

  @Post(':id/iniciar-bot')
  async iniciar(@Param('id') id: string) {
    if (!UUID_REGEX.test(id)) {
      throw new BadRequestException('id deve ser UUID.');
    }
    return this.service.iniciarBot(id);
  }

  /**
   * Dispara a busca do transcript oficial do Teams via Graph (pull). Útil pra
   * processar manualmente após a reunião enquanto o agendador automático não
   * está ligado; idempotente e com retry interno.
   */
  @Post(':id/transcrever-graph')
  async transcreverGraph(@Param('id') id: string) {
    if (!UUID_REGEX.test(id)) {
      throw new BadRequestException('id deve ser UUID.');
    }
    return this.service.transcreverViaGraph(id);
  }

  /**
   * Dispara o bot Playwright (fallback) para entrar na reunião AGORA e capturar
   * as legendas ao vivo. Útil para testar o bot sem esperar o cron de auto-join.
   */
  @Post(':id/transcrever-playwright')
  async transcreverPlaywright(@Param('id') id: string) {
    if (!UUID_REGEX.test(id)) {
      throw new BadRequestException('id deve ser UUID.');
    }
    return this.service.transcreverViaPlaywright(id);
  }

  @Post(':id/encerrar')
  async encerrar(@Param('id') id: string) {
    if (!UUID_REGEX.test(id)) {
      throw new BadRequestException('id deve ser UUID.');
    }
    return this.service.encerrarBot(id);
  }

  @Post(':id/cancelar')
  async cancelar(
    @Param('id') id: string,
    @Body() body: { motivo?: string },
  ) {
    if (!UUID_REGEX.test(id)) {
      throw new BadRequestException('id deve ser UUID.');
    }
    await this.service.cancelar(id, body?.motivo);
    return { status: 'cancelada' };
  }
}
