import { Injectable, Logger } from '@nestjs/common';

import {
  normalizarTexto,
  pareceTextoUtil,
} from './texto.util.js';
import type { TextoExtraido } from './parser.types.js';

/**
 * Parser DOCX baseado em `mammoth`. Devolve apenas texto (raw text),
 * descartando estilos/imagens — currículos quase nunca dependem de formatação.
 *
 * Mammoth processa apenas DOCX (Office Open XML). Arquivos .doc legados (binário CFB)
 * NÃO são suportados — falham com erro claro para que a UI peça ao candidato uma versão DOCX/PDF.
 */
@Injectable()
export class DocxParser {
  private readonly logger = new Logger(DocxParser.name);

  async extrair(buffer: Buffer): Promise<TextoExtraido> {
    if (!buffer || buffer.length === 0) {
      throw new Error('Buffer DOCX vazio.');
    }
    // DOCX = ZIP. Magic bytes: PK\x03\x04
    const magic = buffer.subarray(0, 4);
    if (
      !(
        magic[0] === 0x50 &&
        magic[1] === 0x4b &&
        (magic[2] === 0x03 || magic[2] === 0x05 || magic[2] === 0x07)
      )
    ) {
      throw new Error(
        'Arquivo não é um DOCX válido (assinatura ZIP ausente). .doc legado não é suportado.',
      );
    }

    const mammoth = await import('mammoth');

    const { value, messages } = await mammoth.extractRawText({ buffer });

    if (messages?.length) {
      const warnings = messages
        .filter((m) => m.type === 'warning' || m.type === 'error')
        .slice(0, 5);
      if (warnings.length) {
        this.logger.debug(
          `Mammoth warnings: ${warnings.map((w) => w.message).join('; ')}`,
        );
      }
    }

    const bruto = (value ?? '').trim();
    const normalizado = normalizarTexto(bruto);

    if (!pareceTextoUtil(normalizado)) {
      throw new Error('DOCX produziu texto vazio ou ilegível.');
    }

    return { bruto, normalizado, parser: 'docx' };
  }
}
