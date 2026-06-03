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
  async listar(@Query('candidaturaId') candidaturaId?: string) {
    if (!candidaturaId || !UUID_REGEX.test(candidaturaId)) {
      throw new BadRequestException('candidaturaId é obrigatório (UUID).');
    }
    return this.service.listarPorCandidatura(candidaturaId);
  }

  @Post(':id/iniciar-bot')
  async iniciar(@Param('id') id: string) {
    if (!UUID_REGEX.test(id)) {
      throw new BadRequestException('id deve ser UUID.');
    }
    return this.service.iniciarBot(id);
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
