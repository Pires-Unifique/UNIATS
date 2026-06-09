import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import {
  Prisma,
  StatusAdmissao,
  StatusDocumentoAdmissional,
  ResultadoExameAdmissional,
} from '@uniats/db';

import { AdmissaoService } from './admissao.service.js';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertUuid(id: string, campo = 'id'): void {
  if (!UUID_REGEX.test(id)) {
    throw new BadRequestException(`${campo} inválido.`);
  }
}

function assertEnum<T extends Record<string, string>>(
  valor: unknown,
  e: T,
  campo: string,
): T[keyof T] {
  if (typeof valor !== 'string' || !Object.values(e).includes(valor)) {
    throw new BadRequestException(
      `${campo} inválido. Valores: ${Object.values(e).join(', ')}.`,
    );
  }
  return valor as T[keyof T];
}

@Controller('api/admissoes')
@UseGuards(ThrottlerGuard)
export class AdmissaoController {
  constructor(private readonly service: AdmissaoService) {}

  @Get()
  async listar(@Query('status') status?: string) {
    const s = status
      ? assertEnum(status, StatusAdmissao, 'status')
      : undefined;
    return this.service.listar(s);
  }

  @Get(':id')
  async obter(@Param('id') id: string) {
    assertUuid(id);
    return this.service.obter(id);
  }

  @Post()
  async criar(@Body() body: { candidaturaId?: string }) {
    if (!body?.candidaturaId) {
      throw new BadRequestException('candidaturaId é obrigatório.');
    }
    assertUuid(body.candidaturaId, 'candidaturaId');
    return this.service.criarDeCandidatura(body.candidaturaId);
  }

  @Patch(':id/status')
  async transicionar(
    @Param('id') id: string,
    @Body() body: { para?: string; observacao?: string },
  ) {
    assertUuid(id);
    const para = assertEnum(body?.para, StatusAdmissao, 'para');
    return this.service.transicionar(id, para, {
      observacao: body?.observacao,
    });
  }

  @Post(':id/cancelar')
  async cancelar(@Param('id') id: string, @Body() body: { motivo?: string }) {
    assertUuid(id);
    if (!body?.motivo?.trim()) {
      throw new BadRequestException('motivo é obrigatório.');
    }
    return this.service.cancelar(id, body.motivo.trim());
  }

  @Patch(':id/dados')
  async atualizarDados(
    @Param('id') id: string,
    @Body()
    body: {
      cargo?: string | null;
      salario?: string | number | null;
      tipo_contratacao?: string | null;
      jornada?: string | null;
      data_admissao?: string | null;
      matricula?: string | null;
      observacoes?: string | null;
    },
  ) {
    assertUuid(id);
    const dados: Prisma.AdmissaoUpdateInput = {};
    if (body.cargo !== undefined) dados.cargo = body.cargo;
    if (body.salario !== undefined && body.salario !== null && body.salario !== '') {
      dados.salario = new Prisma.Decimal(body.salario);
    } else if (body.salario === null || body.salario === '') {
      dados.salario = null;
    }
    if (body.tipo_contratacao !== undefined)
      dados.tipo_contratacao = body.tipo_contratacao;
    if (body.jornada !== undefined) dados.jornada = body.jornada;
    if (body.data_admissao !== undefined) {
      dados.data_admissao = body.data_admissao
        ? new Date(body.data_admissao)
        : null;
    }
    if (body.matricula !== undefined) dados.matricula = body.matricula;
    if (body.observacoes !== undefined) dados.observacoes = body.observacoes;
    return this.service.atualizarDados(id, dados);
  }

  @Patch(':id/documentos/:docId')
  async avaliarDocumento(
    @Param('id') id: string,
    @Param('docId') docId: string,
    @Body()
    body: {
      status?: string;
      motivo_recusa?: string | null;
      arquivo_url?: string | null;
      nome_arquivo?: string | null;
    },
  ) {
    assertUuid(id);
    assertUuid(docId, 'docId');
    const status = assertEnum(
      body?.status,
      StatusDocumentoAdmissional,
      'status',
    );
    return this.service.avaliarDocumento(id, docId, {
      status,
      motivo_recusa: body?.motivo_recusa ?? null,
      arquivo_url: body?.arquivo_url ?? null,
      nome_arquivo: body?.nome_arquivo ?? null,
    });
  }

  @Patch(':id/exame')
  async atualizarExame(
    @Param('id') id: string,
    @Body()
    body: {
      clinica?: string | null;
      agendado_para?: string | null;
      realizado_em?: string | null;
      resultado?: string;
      restricoes?: string | null;
      aso_url?: string | null;
    },
  ) {
    assertUuid(id);
    const resultado =
      body?.resultado !== undefined
        ? assertEnum(body.resultado, ResultadoExameAdmissional, 'resultado')
        : undefined;
    return this.service.atualizarExame(id, {
      clinica: body?.clinica,
      agendado_para: body?.agendado_para,
      realizado_em: body?.realizado_em,
      resultado,
      restricoes: body?.restricoes,
      aso_url: body?.aso_url,
    });
  }
}
