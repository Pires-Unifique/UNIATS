import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

import { QuestionsService } from './questions.service.js';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface GerarBody {
  candidaturaId: string;
  entrevistaId?: string;
  substituir?: boolean;
}

interface AtualizarBody {
  pergunta?: string;
  objetivo?: string;
  competencia?: string;
  dificuldade?: 'baixa' | 'media' | 'alta';
  resposta_esperada?: string;
  ordem?: number;
}

@Controller('api/perguntas')
@UseGuards(ThrottlerGuard)
export class QuestionsController {
  constructor(private readonly service: QuestionsService) {}

  @Post('gerar')
  async gerar(@Body() body: GerarBody) {
    if (!body || !UUID_REGEX.test(body.candidaturaId ?? '')) {
      throw new BadRequestException('candidaturaId é obrigatório (UUID).');
    }
    if (body.entrevistaId && !UUID_REGEX.test(body.entrevistaId)) {
      throw new BadRequestException('entrevistaId inválido.');
    }
    return this.service.gerar({
      candidaturaId: body.candidaturaId,
      entrevistaId: body.entrevistaId,
      substituir: body.substituir ?? false,
    });
  }

  @Get()
  async listar(
    @Query('vagaId') vagaId?: string,
    @Query('entrevistaId') entrevistaId?: string,
  ) {
    if (!vagaId && !entrevistaId) {
      throw new BadRequestException('Informe vagaId OU entrevistaId.');
    }
    if (vagaId && !UUID_REGEX.test(vagaId)) {
      throw new BadRequestException('vagaId inválido.');
    }
    if (entrevistaId && !UUID_REGEX.test(entrevistaId)) {
      throw new BadRequestException('entrevistaId inválido.');
    }
    return this.service.listar({ vagaId, entrevistaId });
  }

  @Patch(':id')
  async atualizar(@Param('id') id: string, @Body() body: AtualizarBody) {
    if (!UUID_REGEX.test(id)) {
      throw new BadRequestException('id inválido.');
    }
    return this.service.atualizar(id, body ?? {});
  }

  @Delete(':id')
  async deletar(@Param('id') id: string) {
    if (!UUID_REGEX.test(id)) {
      throw new BadRequestException('id inválido.');
    }
    await this.service.deletar(id);
    return { status: 'ok' };
  }
}
