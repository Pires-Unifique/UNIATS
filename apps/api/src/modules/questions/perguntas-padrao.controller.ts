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

import { Areas } from '../auth/areas.decorator.js';
import { AreasGuard } from '../auth/areas.guard.js';
import { AuthGuard } from '../auth/auth.guard.js';
import type { UsuarioAutenticado } from '../auth/auth.types.js';
import { UsuarioAtual } from '../auth/usuario-atual.decorator.js';
import { PerguntasPadraoService } from './perguntas-padrao.service.js';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface CriarBody {
  pergunta: string;
  objetivo?: string;
  competencia?: string;
  categoria?: string;
  ordem?: number;
}

interface AtualizarBody {
  pergunta?: string;
  objetivo?: string | null;
  competencia?: string | null;
  categoria?: string | null;
  ordem?: number;
  ativo?: boolean;
}

/**
 * Banco de perguntas padrão (DHO). Gestão restrita às áreas 'dho' e
 * 'recrutamento' ('admin' passa sempre) — gestor de vaga não mexe no banco
 * institucional; as perguntas dele são as da própria vaga/entrevista.
 */
@Controller('api/perguntas-padrao')
@UseGuards(ThrottlerGuard, AuthGuard, AreasGuard)
@Areas('dho', 'recrutamento')
export class PerguntasPadraoController {
  constructor(private readonly service: PerguntasPadraoService) {}

  @Get()
  async listar(@Query('incluirInativas') incluirInativas?: string) {
    return this.service.listar({
      incluirInativas: incluirInativas === 'true',
    });
  }

  @Post()
  async criar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Body() body: CriarBody,
  ) {
    if (!body || typeof body.pergunta !== 'string') {
      throw new BadRequestException('pergunta é obrigatória.');
    }
    if (body.ordem != null && (body.ordem < 0 || body.ordem > 100)) {
      throw new BadRequestException('ordem deve estar entre 0 e 100.');
    }
    return this.service.criar({
      pergunta: body.pergunta,
      objetivo: body.objetivo,
      competencia: body.competencia,
      categoria: body.categoria,
      ordem: body.ordem,
      criadoPor: usuario.nome,
    });
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
