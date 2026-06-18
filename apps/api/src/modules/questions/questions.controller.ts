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

import { AuthGuard } from '../auth/auth.guard.js';
import { AuthService } from '../auth/auth.service.js';
import type { UsuarioAutenticado } from '../auth/auth.types.js';
import { UsuarioAtual } from '../auth/usuario-atual.decorator.js';
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
@UseGuards(ThrottlerGuard, AuthGuard)
export class QuestionsController {
  constructor(
    private readonly service: QuestionsService,
    private readonly auth: AuthService,
  ) {}

  @Post('gerar')
  async gerar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Body() body: GerarBody,
  ) {
    if (!body || !UUID_REGEX.test(body.candidaturaId ?? '')) {
      throw new BadRequestException('candidaturaId é obrigatório (UUID).');
    }
    if (body.entrevistaId && !UUID_REGEX.test(body.entrevistaId)) {
      throw new BadRequestException('entrevistaId inválido.');
    }
    await this.auth.assertCandidaturaPermitida(usuario, body.candidaturaId);
    return this.service.gerar({
      candidaturaId: body.candidaturaId,
      entrevistaId: body.entrevistaId,
      substituir: body.substituir ?? false,
    });
  }

  @Get()
  async listar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
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
    if (vagaId) await this.auth.assertVagaPermitida(usuario, vagaId);
    if (entrevistaId) {
      await this.auth.assertEntrevistaPermitida(usuario, entrevistaId);
    }
    return this.service.listar({ vagaId, entrevistaId });
  }

  @Patch(':id')
  async atualizar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('id') id: string,
    @Body() body: AtualizarBody,
  ) {
    if (!UUID_REGEX.test(id)) {
      throw new BadRequestException('id inválido.');
    }
    await this.auth.assertPerguntaPermitida(usuario, id);
    return this.service.atualizar(id, body ?? {});
  }

  @Delete(':id')
  async deletar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Param('id') id: string,
  ) {
    if (!UUID_REGEX.test(id)) {
      throw new BadRequestException('id inválido.');
    }
    await this.auth.assertPerguntaPermitida(usuario, id);
    await this.service.deletar(id);
    return { status: 'ok' };
  }
}
