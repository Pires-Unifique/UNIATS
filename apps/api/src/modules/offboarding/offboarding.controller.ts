import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ThrottlerGuard } from '@nestjs/throttler';
import { PapelAssinanteOffboarding, StatusOffboarding } from '@uniats/db';
import type { Response } from 'express';
import { z } from 'zod';

// Limite do upload do documento assinado (PDF/scan).
const DOC_ASSINADO_MAX_BYTES = Number(
  process.env.OFFBOARDING_DOC_MAX_BYTES ?? 15 * 1024 * 1024,
);

import { Areas } from '../auth/areas.decorator.js';
import { AreasGuard } from '../auth/areas.guard.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { UsuarioAtual } from '../auth/usuario-atual.decorator.js';
import type { UsuarioAutenticado } from '../auth/auth.types.js';
import { OffboardingService } from './offboarding.service.js';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertUuid(id: string, campo = 'id'): void {
  if (!UUID_REGEX.test(id)) {
    throw new BadRequestException(`${campo} inválido.`);
  }
}

const CriarSchema = z.object({
  origem: z.enum(['COLABORADOR', 'EMPREGADOR']),
  colaborador_id: z.string().uuid().nullish(),
  colaborador_matricula: z.string().min(1),
  colaborador_nome: z.string().min(1),
  tipo_desligamento: z.enum([
    'PEDIDO_COLABORADOR',
    'SEM_JUSTA_CAUSA',
    'TERMINO_EXPERIENCIA_DISTRATO',
    'JUSTA_CAUSA',
  ]),
  cumpre_aviso_previo: z.boolean(),
  aviso_previo_dias: z.number().int().positive().nullish(),
  motivo: z.string().min(1, 'Informe o motivo.'),
  email_pessoal: z.string().nullish(),
  whatsapp_pessoal: z.string().nullish(),
  forma_assinatura: z.enum(['DIGITAL', 'FISICA']),
});

function ctx(u: UsuarioAutenticado) {
  return { id: u.id, nome: u.nome, email: u.email };
}

/**
 * Solicitações de offboarding. Acesso do LÍDER/colaborador é apenas autenticação
 * (sem `@Areas`): a API escopa por solicitante; as APROVAÇÕES (gestor do CC + DHO)
 * usam `@Areas('dho')` nesta fase — o gate do "gerente do CC" plugará na detecção
 * de liderança (Senior/MS) depois ("depois vamos segregar acessos").
 */
@Controller('api/offboarding')
@UseGuards(ThrottlerGuard, AuthGuard, AreasGuard)
export class OffboardingController {
  constructor(private readonly service: OffboardingService) {}

  @Get()
  async listar(
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Query('status') status?: string,
    @Query('meu') meu?: string,
  ) {
    const s =
      status && status in StatusOffboarding
        ? (status as StatusOffboarding)
        : undefined;
    const apenasMeu =
      meu === '1' &&
      !usuario.areas.includes('admin') &&
      !usuario.areas.includes('dho');
    return this.service.listar({
      status: s,
      solicitanteId: apenasMeu ? usuario.id : undefined,
    });
  }

  /** Contatos pessoais (prefill do formulário) — busca no Senior (simulado). */
  @Get('contatos')
  async contatos(@Query('matricula') matricula?: string) {
    if (!matricula?.trim()) {
      throw new BadRequestException('matricula é obrigatória.');
    }
    return this.service.obterContatos(matricula.trim());
  }

  @Get(':id')
  async obter(@Param('id') id: string) {
    assertUuid(id);
    return this.service.obter(id);
  }

  @Get(':id/documento')
  async documento(
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    assertUuid(id);
    const doc = await this.service.obterDocumento(id);
    res.set({
      'Content-Type': doc.contentType,
      'Content-Disposition': `attachment; filename="${doc.filename}"`,
    });
    return new StreamableFile(doc.body);
  }

  /** Download do documento ASSINADO anexado manualmente. */
  @Get(':id/documento-assinado')
  async documentoAssinado(
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    assertUuid(id);
    const doc = await this.service.obterDocumentoAssinado(id);
    res.set({
      'Content-Type': doc.contentType,
      'Content-Disposition': `attachment; filename="${doc.filename}"`,
    });
    return new StreamableFile(doc.body);
  }

  /** Upload do documento assinado (multipart, campo "arquivo") — só DHO. */
  @Post(':id/documento-assinado')
  @Areas('dho')
  @UseInterceptors(
    FileInterceptor('arquivo', { limits: { fileSize: DOC_ASSINADO_MAX_BYTES } }),
  )
  async anexarDocumentoAssinado(
    @Param('id') id: string,
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @UploadedFile() arquivo?: Express.Multer.File,
  ) {
    assertUuid(id);
    if (!arquivo || !arquivo.buffer?.length) {
      throw new BadRequestException('Envie o arquivo no campo "arquivo".');
    }
    return this.service.anexarDocumentoAssinado(
      id,
      {
        buffer: arquivo.buffer,
        originalname: arquivo.originalname,
        mimetype: arquivo.mimetype,
      },
      ctx(usuario),
    );
  }

  /** DHO valida as assinaturas e libera o encerramento (→ ASSINADO). */
  @Post(':id/validar-assinaturas')
  @Areas('dho')
  async validarAssinaturas(
    @Param('id') id: string,
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Body() body: { procurador_id?: string },
  ) {
    assertUuid(id);
    if (body?.procurador_id) assertUuid(body.procurador_id, 'procurador_id');
    return this.service.validarAssinaturas(id, ctx(usuario), {
      procuradorId: body?.procurador_id,
    });
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

  @Post(':id/aprovar-gestor')
  @Areas('dho')
  async aprovarGestor(
    @Param('id') id: string,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ) {
    assertUuid(id);
    return this.service.aprovarGestor(id, ctx(usuario));
  }

  @Post(':id/aprovar-dho')
  @Areas('dho')
  async aprovarDho(
    @Param('id') id: string,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ) {
    assertUuid(id);
    return this.service.aprovarDho(id, ctx(usuario));
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
   * exercitar o fluxo. Na via física, o REPRESENTANTE exige `procurador_id`.
   */
  @Post(':id/assinar')
  @Areas('dho')
  async assinar(
    @Param('id') id: string,
    @Body() body: { papel?: string; procurador_id?: string },
  ) {
    assertUuid(id);
    if (
      body?.papel !== PapelAssinanteOffboarding.COLABORADOR &&
      body?.papel !== PapelAssinanteOffboarding.REPRESENTANTE_EMPRESA
    ) {
      throw new BadRequestException(
        `papel inválido. Valores: ${PapelAssinanteOffboarding.COLABORADOR}, ${PapelAssinanteOffboarding.REPRESENTANTE_EMPRESA}.`,
      );
    }
    if (body.procurador_id) assertUuid(body.procurador_id, 'procurador_id');
    return this.service.registrarAssinatura(id, body.papel, {
      assinado: true,
      procuradorId: body.procurador_id,
    });
  }

  @Post(':id/iniciar-encerramento')
  @Areas('dho')
  async iniciarEncerramento(
    @Param('id') id: string,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ) {
    assertUuid(id);
    return this.service.iniciarEncerramento(id, ctx(usuario));
  }

  /** Responde um item do checklist OU reexecuta uma integração. */
  @Post(':id/itens/:chave')
  async responderItem(
    @Param('id') id: string,
    @Param('chave') chave: string,
    @UsuarioAtual() usuario: UsuarioAutenticado,
    @Body()
    body: {
      resposta_bool?: boolean;
      resposta_texto?: string;
      nao_aplicavel?: boolean;
      executar_integracao?: boolean;
    },
  ) {
    assertUuid(id);
    if (body?.executar_integracao) {
      return this.service.executarIntegracao(id, chave, ctx(usuario));
    }
    return this.service.responderItem(
      id,
      chave,
      {
        resposta_bool: body?.resposta_bool,
        resposta_texto: body?.resposta_texto,
        nao_aplicavel: body?.nao_aplicavel,
      },
      ctx(usuario),
    );
  }

  @Post(':id/concluir')
  async concluir(
    @Param('id') id: string,
    @UsuarioAtual() usuario: UsuarioAutenticado,
  ) {
    assertUuid(id);
    return this.service.concluir(id, ctx(usuario));
  }
}
