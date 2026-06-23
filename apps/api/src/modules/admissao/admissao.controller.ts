import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ThrottlerGuard } from '@nestjs/throttler';
import {
  Prisma,
  StatusAdmissao,
  StatusDocumentoAdmissional,
  ResultadoExameAdmissional,
} from '@uniats/db';

import { Areas } from '../auth/areas.decorator.js';
import { AreasGuard } from '../auth/areas.guard.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { AdmissaoService } from './admissao.service.js';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Limite de upload de documento (RG, etc.). Lido do env no load (process.env
// já está populado pelo bootstrap-env antes do AppModule).
const RG_MAX_SIZE_BYTES = Number(
  process.env.RG_MAX_SIZE_BYTES ?? 10 * 1024 * 1024,
);

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

// Admissão é uma EQUIPE separada do recrutamento → área própria 'admissao'.
@Controller('api/admissoes')
@UseGuards(ThrottlerGuard, AuthGuard, AreasGuard)
@Areas('admissao')
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

  // Importa em lote os candidatos já CONTRATADOS (que passaram do R&S) que ainda
  // não têm admissão. `desdeDias` limita a contratações recentes.
  @Post('backfill')
  async backfill(@Body() body: { desdeDias?: number; limite?: number }) {
    return this.service.backfillContratados({
      desdeDias:
        typeof body?.desdeDias === 'number' ? body.desdeDias : undefined,
      limite: typeof body?.limite === 'number' ? body.limite : undefined,
    });
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

  // Upload do arquivo de um documento (multipart, campo "arquivo"). Para o RG,
  // dispara o OCR por IA e, em seguida, o gatilho de criação de acesso.
  @Post(':id/documentos/:docId/arquivo')
  @UseInterceptors(
    FileInterceptor('arquivo', { limits: { fileSize: RG_MAX_SIZE_BYTES } }),
  )
  async anexarArquivoDocumento(
    @Param('id') id: string,
    @Param('docId') docId: string,
    @UploadedFile() arquivo?: Express.Multer.File,
  ) {
    assertUuid(id);
    assertUuid(docId, 'docId');
    if (!arquivo || !arquivo.buffer?.length) {
      throw new BadRequestException('Envie o arquivo no campo "arquivo".');
    }
    return this.service.anexarArquivoDocumento(id, docId, {
      buffer: arquivo.buffer,
      originalname: arquivo.originalname,
      mimetype: arquivo.mimetype,
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
