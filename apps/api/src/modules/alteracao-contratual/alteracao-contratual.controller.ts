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
import { PapelAssinante, StatusAlteracaoContratual } from '@uniats/db';
import type { UsuarioAutenticado } from '../auth/auth.types.js';
import { z } from 'zod';

import { Areas } from '../auth/areas.decorator.js';
import { AreasGuard } from '../auth/areas.guard.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { UsuarioAtual } from '../auth/usuario-atual.decorator.js';
import { AlteracaoContratualService } from './alteracao-contratual.service.js';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertUuid(id: string, campo = 'id'): void {
  if (!UUID_REGEX.test(id)) {
    throw new BadRequestException(`${campo} inválido.`);
  }
}

const ItemSchema = z.object({
  tipo: z.enum(['CARGO', 'SALARIO', 'CENTRO_CUSTO', 'UNIDADE', 'LIDER']),
  valor_anterior: z.string().nullish(),
  valor_novo: z.string().nullish(),
  cargo_novo_id: z.string().uuid().nullish(),
  unidade_nova_id: z.string().uuid().nullish(),
  centro_custo_novo_id: z.string().uuid().nullish(),
  salario_anterior: z.union([z.string(), z.number()]).nullish(),
  salario_novo: z.union([z.string(), z.number()]).nullish(),
  novo_lider_matricula: z.string().nullish(),
  novo_lider_nome: z.string().nullish(),
});

const CriarSchema = z.object({
  colaborador_id: z.string().uuid().nullish(),
  colaborador_matricula: z.string().min(1),
  colaborador_nome: z.string().min(1),
  unidade_atual: z.string().nullish(),
  centro_custo_atual: z.string().nullish(),
  cargo_atual: z.string().nullish(),
  lider_atual: z.string().nullish(),
  razoes: z.string().min(1, 'Informe as razões.'),
  data_aplicacao: z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'Use YYYY-MM-DD.'),
  itens: z.array(ItemSchema).min(1, 'Informe ao menos uma alteração.'),
});

function ctx(u: UsuarioAutenticado) {
  return { id: u.id, nome: u.nome, email: u.email };
}

/**
 * Solicitações de alteração contratual. Acesso do LÍDER é apenas autenticação
 * (sem `@Areas`): a API escopa por solicitante; ações exclusivas do DHO usam
 * `@Areas('dho')` no método. (Detecção de liderança virá depois — Senior/MS.)
 */
@Controller('api/alteracao-contratual')
@UseGuards(ThrottlerGuard, AuthGuard, AreasGuard)
export class AlteracaoContratualController {
  constructor(private readonly service: AlteracaoContratualService) {}

  @Get()
  async listar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Query('status') status?: string,
    @Query('meu') meu?: string,
  ) {
    const s =
      status && status in StatusAlteracaoContratual
        ? (status as StatusAlteracaoContratual)
        : undefined;
    // `meu=1` restringe às solicitações do próprio líder (a menos que admin/dho).
    const apenasMeu =
      meu === '1' &&
      !usuario.areas.includes('admin') &&
      !usuario.areas.includes('dho');
    return this.service.listar({
      status: s,
      solicitanteId: apenasMeu ? usuario.id : undefined,
    });
  }

  @Get(':id')
  async obter(@Param('id') id: string) {
    assertUuid(id);
    return this.service.obter(id);
  }

  @Post()
  async criar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Body() body: unknown,
  ) {
    const parsed = CriarSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues[0]?.message ?? 'Dados inválidos.');
    }
    return this.service.criar(parsed.data, ctx(usuario));
  }

  @Post(':id/submeter')
  async submeter(
    @Param('id') id: string,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ) {
    assertUuid(id);
    return this.service.submeter(id, ctx(usuario));
  }

  @Post(':id/aprovar')
  @Areas('dho')
  async aprovar(
    @Param('id') id: string,
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Body() body: { gestor_nome?: string; gestor_email?: string },
  ) {
    assertUuid(id);
    return this.service.aprovar(id, ctx(usuario), {
      gestorNome: body?.gestor_nome,
      gestorEmail: body?.gestor_email,
    });
  }

  @Post(':id/recusar')
  @Areas('dho')
  async recusar(
    @Param('id') id: string,
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Body() body: { motivo?: string },
  ) {
    assertUuid(id);
    if (!body?.motivo?.trim()) {
      throw new BadRequestException('motivo é obrigatório.');
    }
    return this.service.recusar(id, body.motivo.trim(), ctx(usuario));
  }

  @Post(':id/cancelar')
  async cancelar(
    @Param('id') id: string,
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Body() body: { motivo?: string },
  ) {
    assertUuid(id);
    if (!body?.motivo?.trim()) {
      throw new BadRequestException('motivo é obrigatório.');
    }
    return this.service.cancelar(id, body.motivo.trim(), ctx(usuario));
  }

  /**
   * Registra assinatura manualmente — útil no modo Autentique SIMULADO para
   * exercitar o fluxo (com a integração real, o webhook faz isso).
   */
  @Post(':id/assinar')
  @Areas('dho')
  async assinar(
    @Param('id') id: string,
    @Body() body: { papel?: string },
  ) {
    assertUuid(id);
    if (body?.papel !== PapelAssinante.GESTOR && body?.papel !== PapelAssinante.DHO) {
      throw new BadRequestException(
        `papel inválido. Valores: ${PapelAssinante.GESTOR}, ${PapelAssinante.DHO}.`,
      );
    }
    return this.service.registrarAssinatura(id, body.papel, { assinado: true });
  }
}
