import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ThrottlerGuard } from '@nestjs/throttler';

import { PublicarVagaInputSchema } from '@uniats/shared';

import { Areas } from '../auth/areas.decorator.js';
import { AreasGuard } from '../auth/areas.guard.js';
import { AuthGuard } from '../auth/auth.guard.js';
import { TemplateParser } from './template-parser.js';
import { VagaTemplateService } from './vaga-template.service.js';

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * Importação do template padrão "Descrição do Cargo" (DHO) e publicação da
 * vaga resultante na Gupy.
 *
 * Fluxo:
 *  POST /api/vagas/template/importar  (multipart) → parse + arquiva → devolve o
 *    template estruturado (campos editáveis no frontend) + arquivoSha256.
 *  POST /api/vagas/template/publicar  (JSON)      → cria rascunho na Gupy,
 *    publica se solicitado e persiste a Vaga local.
 */
@Controller('api/vagas/template')
@UseGuards(ThrottlerGuard, AuthGuard, AreasGuard)
@Areas('recrutamento')
export class VagaTemplateController {
  constructor(private readonly service: VagaTemplateService) {}

  @Post('importar')
  @UseInterceptors(
    FileInterceptor('arquivo', { limits: { fileSize: MAX_BYTES } }),
  )
  async importar(@UploadedFile() arquivo?: Express.Multer.File) {
    if (!arquivo || !arquivo.buffer?.length) {
      throw new BadRequestException('Envie o arquivo .xlsx no campo "arquivo".');
    }
    const nomeOk = /\.xlsx$/i.test(arquivo.originalname ?? '');
    if (!nomeOk) {
      throw new BadRequestException('O arquivo deve ter extensão .xlsx.');
    }

    const template = await TemplateParser.parseXlsx(arquivo.buffer);
    const arquivoSha256 = await this.service.arquivarTemplate(arquivo.buffer);

    return { template, arquivoSha256 };
  }

  @Post('publicar')
  async publicar(@Body() body: unknown) {
    const parsed = PublicarVagaInputSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: 'Dados da vaga inválidos.',
        issues: parsed.error.flatten(),
      });
    }
    return this.service.publicar(parsed.data);
  }
}
