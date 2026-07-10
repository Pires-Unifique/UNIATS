import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

import { AuthGuard } from '../auth/auth.guard.js';
import { AuthService } from '../auth/auth.service.js';
import type { UsuarioAutenticado } from '../auth/auth.types.js';
import { UsuarioAtual } from '../auth/usuario-atual.decorator.js';
import { RespostasEntrevistaService } from './respostas-entrevista.service.js';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Respostas do candidato (análise IA do transcript × roteiro de perguntas).
 * Mesmo escopo de acesso da entrevista (gestor da vaga / recrutamento / admin).
 */
@Controller('api/respostas')
@UseGuards(ThrottlerGuard, AuthGuard)
export class RespostasController {
  constructor(
    private readonly service: RespostasEntrevistaService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  async listar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Query('entrevistaId') entrevistaId?: string,
  ) {
    if (!entrevistaId || !UUID_REGEX.test(entrevistaId)) {
      throw new BadRequestException('entrevistaId é obrigatório (UUID).');
    }
    await this.auth.assertEntrevistaPermitida(usuario, entrevistaId);
    return this.service.listar(entrevistaId);
  }

  /**
   * (Re)analisa as respostas da entrevista com IA. Síncrono como o gerador de
   * perguntas (~dezenas de segundos); a fusão da transcrição também dispara a
   * análise automaticamente — este endpoint cobre reprocessos (ex.: pergunta
   * cadastrada depois da reunião).
   */
  @Post('analisar')
  async analisar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Body() body: { entrevistaId?: string },
  ) {
    if (!body?.entrevistaId || !UUID_REGEX.test(body.entrevistaId)) {
      throw new BadRequestException('entrevistaId é obrigatório (UUID).');
    }
    await this.auth.assertEntrevistaPermitida(usuario, body.entrevistaId);
    return this.service.analisar(body.entrevistaId);
  }
}
