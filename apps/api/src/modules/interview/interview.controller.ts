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

import { AuthGuard } from '../auth/auth.guard.js';
import { AuthService } from '../auth/auth.service.js';
import type { UsuarioAutenticado } from '../auth/auth.types.js';
import { UsuarioAtual } from '../auth/usuario-atual.decorator.js';
import { InterviewService } from './services/interview.service.js';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface AgendarBody {
  candidaturaId: string;
  agendadaPara: string; // ISO-8601
  /** Opcional: se omitido/vazio, o sistema gera a sala no Teams automaticamente. */
  meetUrl?: string;
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
@UseGuards(ThrottlerGuard, AuthGuard)
export class InterviewController {
  constructor(
    private readonly service: InterviewService,
    private readonly auth: AuthService,
  ) {}

  @Post()
  async agendar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Body() body: AgendarBody,
  ) {
    if (!body || typeof body !== 'object') {
      throw new BadRequestException('Body inválido.');
    }
    if (!UUID_REGEX.test(body.candidaturaId ?? '')) {
      throw new BadRequestException('candidaturaId deve ser UUID.');
    }
    await this.auth.assertCandidaturaPermitida(usuario, body.candidaturaId);
    // meetUrl é OPCIONAL: ou o recrutador informa o link, ou o sistema gera a sala
    // no Teams (serviço). Quando informado, validamos https, formato e tamanho;
    // depois ele é consumido pelo bot (Playwright navega até ele).
    if (body.meetUrl != null && body.meetUrl !== '') {
      if (typeof body.meetUrl !== 'string' || body.meetUrl.length > 2048) {
        throw new BadRequestException('meetUrl inválido (máx. 2048 chars).');
      }
      let meetUrlParsed: URL;
      try {
        meetUrlParsed = new URL(body.meetUrl);
      } catch {
        throw new BadRequestException('meetUrl deve ser uma URL válida.');
      }
      if (meetUrlParsed.protocol !== 'https:') {
        throw new BadRequestException('meetUrl deve usar https.');
      }
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
      meetUrl: body.meetUrl || undefined,
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
  async confirmarEnquete(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Body() body: ConfirmarEnqueteBody,
  ) {
    if (!body || typeof body !== 'object') {
      throw new BadRequestException('Body inválido.');
    }
    if (!UUID_REGEX.test(body.enqueteId ?? '')) {
      throw new BadRequestException('enqueteId deve ser UUID.');
    }
    await this.auth.assertEnquetePermitida(usuario, body.enqueteId);
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
  async obter(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('id') id: string,
  ) {
    if (!UUID_REGEX.test(id)) {
      throw new BadRequestException('id deve ser UUID.');
    }
    await this.auth.assertEntrevistaPermitida(usuario, id);
    return this.service.obter(id);
  }

  @Get()
  async listar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Query('candidaturaId') candidaturaId?: string,
    @Query('status') status?: string,
  ) {
    // Com candidaturaId: histórico daquela candidatura (uso no detalhe do
    // candidato). Sem candidaturaId: agenda — escopada às vagas do gestor.
    if (candidaturaId) {
      if (!UUID_REGEX.test(candidaturaId)) {
        throw new BadRequestException('candidaturaId deve ser UUID.');
      }
      await this.auth.assertCandidaturaPermitida(usuario, candidaturaId);
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
    // Gestor vê só a agenda das vagas dele; admin/recrutamento veem tudo.
    return this.service.listarAgenda(status, this.auth.escopoGestorId(usuario));
  }

  /**
   * Dispara a busca do transcript oficial do Teams via Graph (pull). Útil pra
   * processar manualmente após a reunião enquanto o agendador automático não
   * está ligado; idempotente e com retry interno.
   */
  @Post(':id/transcrever-graph')
  async transcreverGraph(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('id') id: string,
  ) {
    if (!UUID_REGEX.test(id)) {
      throw new BadRequestException('id deve ser UUID.');
    }
    await this.auth.assertEntrevistaPermitida(usuario, id);
    return this.service.transcreverViaGraph(id);
  }

  /**
   * Dispara o bot Playwright (fallback) para entrar na reunião AGORA e capturar
   * as legendas ao vivo. Útil para testar o bot sem esperar o cron de auto-join.
   */
  @Post(':id/transcrever-playwright')
  async transcreverPlaywright(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('id') id: string,
  ) {
    if (!UUID_REGEX.test(id)) {
      throw new BadRequestException('id deve ser UUID.');
    }
    await this.auth.assertEntrevistaPermitida(usuario, id);
    return this.service.transcreverViaPlaywright(id);
  }

  @Post(':id/cancelar')
  async cancelar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('id') id: string,
    @Body() body: { motivo?: string },
  ) {
    if (!UUID_REGEX.test(id)) {
      throw new BadRequestException('id deve ser UUID.');
    }
    await this.auth.assertEntrevistaPermitida(usuario, id);
    await this.service.cancelar(id, body?.motivo);
    return { status: 'cancelada' };
  }

  /** Salva as anotações do recrutador (bloco de notas da entrevista). */
  @Post(':id/anotacoes')
  async salvarAnotacoes(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('id') id: string,
    @Body() body: { anotacoes?: string },
  ) {
    if (!UUID_REGEX.test(id)) {
      throw new BadRequestException('id deve ser UUID.');
    }
    if (typeof body?.anotacoes !== 'string') {
      throw new BadRequestException('anotacoes deve ser string.');
    }
    await this.auth.assertEntrevistaPermitida(usuario, id);
    return this.service.salvarAnotacoes(id, body.anotacoes);
  }
}
