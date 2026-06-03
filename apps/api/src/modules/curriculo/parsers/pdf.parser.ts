import { Injectable, Logger } from '@nestjs/common';

import {
  normalizarTexto,
  pareceTextoUtil,
} from './texto.util.js';
import type { TextoExtraido } from './parser.types.js';

/**
 * Parser PDF baseado em `pdf-parse`. Carregamento dinâmico para evitar
 * o side-effect de leitura de arquivo de teste do package na inicialização.
 *
 * NOTA: pdf-parse não executa JavaScript do PDF (bom — reduz superfície de ataque)
 * mas também não faz OCR. Currículos escaneados como imagem → texto vazio.
 * Quando detectarmos isso, sinalizamos erro recuperável para revisão humana.
 */
@Injectable()
export class PdfParser {
  private readonly logger = new Logger(PdfParser.name);

  async extrair(buffer: Buffer): Promise<TextoExtraido> {
    if (!buffer || buffer.length === 0) {
      throw new Error('Buffer PDF vazio.');
    }
    // Valida magic bytes (%PDF) — defesa contra content-type spoofado.
    if (buffer.subarray(0, 4).toString('ascii') !== '%PDF') {
      throw new Error('Arquivo não é um PDF válido (magic bytes ausentes).');
    }

    // Import dinâmico para não rodar o teste embutido do pdf-parse no boot.
    const { default: pdfParse } = await import('pdf-parse');

    const result = await pdfParse(buffer, {
      // Limite duro: 1000 páginas. Currículos de RH não passam disso —
      // se passar, é PDF malformado ou hostil.
      max: 1000,
    });

    const bruto = (result.text ?? '').trim();
    const normalizado = normalizarTexto(bruto);

    if (!pareceTextoUtil(normalizado)) {
      this.logger.warn(
        `PDF retornou texto inutilizável (${normalizado.length} chars). ` +
          'Provavelmente é currículo escaneado sem OCR.',
      );
      throw new Error(
        'PDF parece ser uma imagem escaneada — OCR não está implementado nesta fase.',
      );
    }

    return {
      bruto,
      normalizado,
      paginas: result.numpages,
      parser: 'pdf',
    };
  }
}
