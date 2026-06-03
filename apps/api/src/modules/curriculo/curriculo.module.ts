import { Module } from '@nestjs/common';

import { GupyModule } from '../gupy/gupy.module.js';
import { CurriculoController } from './curriculo.controller.js';
import { CurriculoService } from './curriculo.service.js';
import { CvDownloadProcessor } from './processors/cv-download.processor.js';
import { CvParseProcessor } from './processors/cv-parse.processor.js';
import { DocxParser } from './parsers/docx.parser.js';
import { ParserService } from './parsers/parser.service.js';
import { PdfParser } from './parsers/pdf.parser.js';

/**
 * Camada 2 — Processamento de Currículos.
 *
 * Composição:
 *  - Parsers: PDF/DOCX/TXT → texto bruto + normalizado.
 *  - ClaudeService (módulo global) → estrutura currículo via tool-use.
 *  - StorageService (módulo global) → persistência em S3/MinIO.
 *  - Workers BullMQ: cv-download e cv-parse.
 *  - REST: GET/POST em /api/curriculos/:candidaturaId
 *
 * Depende de GupyModule (para reaproveitar GupyClient no download — única
 * fonte que sabe SSRF guards, rate limit e errback do provedor).
 */
@Module({
  imports: [GupyModule],
  controllers: [CurriculoController],
  providers: [
    CurriculoService,
    ParserService,
    PdfParser,
    DocxParser,
    CvDownloadProcessor,
    CvParseProcessor,
  ],
  exports: [CurriculoService, ParserService],
})
export class CurriculoModule {}
