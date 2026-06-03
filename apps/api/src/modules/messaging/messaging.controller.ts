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

import { MessagingService } from './messaging.service.js';
import { TemplatesService } from './templates/templates.service.js';
import { VARIAVEIS_DISPONIVEIS } from './templates/variaveis.catalog.js';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CODIGO_REGEX = /^[a-z][a-z0-9_]*$/;

interface EnviarBody {
  candidaturaId: string;
  canal: 'WHATSAPP' | 'EMAIL';
  templateCodigo: string;
  variaveis: Record<string, string | number>;
  permitirFallback?: boolean;
  agendadoPara?: string; // ISO-8601
}

interface CriarTemplateBody {
  codigo: string;
  nome: string;
  descricao?: string;
  whatsappCorpo?: string;
  emailAssunto?: string;
  emailTexto?: string;
  emailHtml?: string;
  usuarioId?: string;
}

type EditarTemplateBody = Omit<CriarTemplateBody, 'codigo'>;

@Controller('api/mensagens')
@UseGuards(ThrottlerGuard)
export class MessagingController {
  constructor(
    private readonly service: MessagingService,
    private readonly templates: TemplatesService,
  ) {}

  /** ----------------------------------------------------------------------
   *  Templates (rotas literais — declaradas ANTES de `@Get(':id')`).
   *  --------------------------------------------------------------------- */

  /** Cataloga templates ativos (UI consome para montar formulário). */
  @Get('templates')
  listarTemplates() {
    return this.templates.listarAtivos();
  }

  /** Variáveis disponíveis (botões de inserção + rótulos amigáveis na UI). */
  @Get('variaveis')
  listarVariaveis() {
    return VARIAVEIS_DISPONIVEIS;
  }

  @Post('templates')
  async criarTemplate(@Body() body: CriarTemplateBody) {
    if (!body || typeof body !== 'object') {
      throw new BadRequestException('Body inválido.');
    }
    if (!body.codigo || !CODIGO_REGEX.test(body.codigo)) {
      throw new BadRequestException(
        'codigo deve começar por letra e conter apenas [a-z0-9_].',
      );
    }
    if (!body.nome || typeof body.nome !== 'string') {
      throw new BadRequestException('nome é obrigatório.');
    }
    return this.templates.criar({
      codigo: body.codigo,
      nome: body.nome,
      descricao: body.descricao,
      whatsappCorpo: body.whatsappCorpo,
      emailAssunto: body.emailAssunto,
      emailTexto: body.emailTexto,
      emailHtml: body.emailHtml,
      usuarioId:
        body.usuarioId && UUID_REGEX.test(body.usuarioId)
          ? body.usuarioId
          : undefined,
    });
  }

  @Patch('templates/:codigo')
  async editarTemplate(
    @Param('codigo') codigo: string,
    @Body() body: EditarTemplateBody,
  ) {
    if (!CODIGO_REGEX.test(codigo)) {
      throw new BadRequestException('codigo inválido.');
    }
    if (!body || typeof body !== 'object') {
      throw new BadRequestException('Body inválido.');
    }
    return this.templates.atualizar(codigo, {
      nome: body.nome,
      descricao: body.descricao,
      whatsappCorpo: body.whatsappCorpo,
      emailAssunto: body.emailAssunto,
      emailTexto: body.emailTexto,
      emailHtml: body.emailHtml,
      usuarioId:
        body.usuarioId && UUID_REGEX.test(body.usuarioId)
          ? body.usuarioId
          : undefined,
    });
  }

  @Delete('templates/:codigo')
  async desabilitarTemplate(@Param('codigo') codigo: string) {
    if (!CODIGO_REGEX.test(codigo)) {
      throw new BadRequestException('codigo inválido.');
    }
    return this.templates.desabilitar(codigo);
  }

  /** Variáveis padrão de uma candidatura (pré-preenchimento da UI). */
  @Get('contexto/:candidaturaId')
  async contexto(@Param('candidaturaId') candidaturaId: string) {
    if (!UUID_REGEX.test(candidaturaId)) {
      throw new BadRequestException('candidaturaId deve ser UUID válido.');
    }
    return this.service.resolverContexto(candidaturaId);
  }

  /** ----------------------------------------------------------------------
   *  Envio + histórico
   *  --------------------------------------------------------------------- */

  @Post('enviar')
  async enviar(@Body() body: EnviarBody) {
    if (!body || typeof body !== 'object') {
      throw new BadRequestException('Body inválido.');
    }
    if (!UUID_REGEX.test(body.candidaturaId ?? '')) {
      throw new BadRequestException('candidaturaId deve ser UUID válido.');
    }
    if (body.canal !== 'WHATSAPP' && body.canal !== 'EMAIL') {
      throw new BadRequestException('canal deve ser WHATSAPP ou EMAIL.');
    }
    if (!body.templateCodigo || typeof body.templateCodigo !== 'string') {
      throw new BadRequestException('templateCodigo é obrigatório.');
    }
    if (!body.variaveis || typeof body.variaveis !== 'object') {
      throw new BadRequestException('variaveis deve ser objeto.');
    }
    let agendadoPara: Date | undefined;
    if (body.agendadoPara) {
      const d = new Date(body.agendadoPara);
      if (Number.isNaN(d.getTime())) {
        throw new BadRequestException('agendadoPara deve ser ISO-8601.');
      }
      if (d.getTime() - Date.now() > 30 * 24 * 3600 * 1000) {
        throw new BadRequestException(
          'agendadoPara não pode estar a mais de 30 dias no futuro.',
        );
      }
      agendadoPara = d;
    }
    return this.service.enfileirar({
      candidaturaId: body.candidaturaId,
      canal: body.canal,
      templateCodigo: body.templateCodigo,
      variaveis: body.variaveis,
      permitirFallback: body.permitirFallback,
      agendadoPara,
    });
  }

  @Get(':id')
  async obter(@Param('id') id: string) {
    if (!UUID_REGEX.test(id)) {
      throw new BadRequestException('id deve ser UUID válido.');
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
}
