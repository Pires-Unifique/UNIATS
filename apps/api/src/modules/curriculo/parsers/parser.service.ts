import {
  Injectable,
  Logger,
  UnsupportedMediaTypeException,
} from '@nestjs/common';

import { PdfParser } from './pdf.parser.js';
import { DocxParser } from './docx.parser.js';
import { normalizarTexto } from './texto.util.js';
import type { TextoExtraido } from './parser.types.js';

/**
 * Roteador de parsers. Despacha para PDF/DOCX/TXT com base no content-type
 * (com validação de magic bytes dentro de cada parser).
 */
@Injectable()
export class ParserService {
  private readonly logger = new Logger(ParserService.name);

  constructor(
    private readonly pdf: PdfParser,
    private readonly docx: DocxParser,
  ) {}

  async extrairTexto(
    buffer: Buffer,
    contentType: string,
  ): Promise<TextoExtraido> {
    const tipo = (contentType ?? '').toLowerCase().split(';')[0].trim();

    switch (tipo) {
      case 'application/pdf':
        return this.pdf.extrair(buffer);

      case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
        return this.docx.extrair(buffer);

      case 'application/msword':
        throw new UnsupportedMediaTypeException(
          '.doc legado não é suportado — peça ao candidato uma versão .docx ou .pdf.',
        );

      case 'text/plain': {
        const bruto = buffer.toString('utf8').trim();
        const normalizado = normalizarTexto(bruto);
        return { bruto, normalizado, parser: 'txt' };
      }

      default:
        throw new UnsupportedMediaTypeException(
          `Content-Type não suportado: "${tipo}"`,
        );
    }
  }
}
