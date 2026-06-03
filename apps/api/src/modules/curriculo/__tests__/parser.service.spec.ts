import { UnsupportedMediaTypeException } from '@nestjs/common';

import { DocxParser } from '../parsers/docx.parser.js';
import { ParserService } from '../parsers/parser.service.js';
import { PdfParser } from '../parsers/pdf.parser.js';

describe('ParserService', () => {
  let pdf: jest.Mocked<PdfParser>;
  let docx: jest.Mocked<DocxParser>;
  let service: ParserService;

  beforeEach(() => {
    pdf = { extrair: jest.fn() } as unknown as jest.Mocked<PdfParser>;
    docx = { extrair: jest.fn() } as unknown as jest.Mocked<DocxParser>;
    service = new ParserService(pdf, docx);
  });

  it('roteia application/pdf para PdfParser', async () => {
    pdf.extrair.mockResolvedValue({
      bruto: 'cv',
      normalizado: 'cv',
      parser: 'pdf',
    });
    const out = await service.extrairTexto(Buffer.from('x'), 'application/pdf');
    expect(pdf.extrair).toHaveBeenCalled();
    expect(out.parser).toBe('pdf');
  });

  it('roteia DOCX OpenXML para DocxParser', async () => {
    docx.extrair.mockResolvedValue({
      bruto: 'cv',
      normalizado: 'cv',
      parser: 'docx',
    });
    const out = await service.extrairTexto(
      Buffer.from('x'),
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(docx.extrair).toHaveBeenCalled();
    expect(out.parser).toBe('docx');
  });

  it('processa text/plain inline', async () => {
    const out = await service.extrairTexto(
      Buffer.from('linha   1\nlinha 2', 'utf8'),
      'text/plain',
    );
    expect(out.parser).toBe('txt');
    expect(out.normalizado).toBe('linha 1\nlinha 2');
  });

  it('ignora parâmetros do content-type (ex.: ; charset=utf-8)', async () => {
    docx.extrair.mockResolvedValue({
      bruto: '',
      normalizado: '',
      parser: 'docx',
    });
    await service.extrairTexto(
      Buffer.from('x'),
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document; charset=utf-8',
    );
    expect(docx.extrair).toHaveBeenCalled();
  });

  it('rejeita .doc legado com erro claro', async () => {
    await expect(
      service.extrairTexto(Buffer.from('x'), 'application/msword'),
    ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
  });

  it('rejeita tipos não suportados', async () => {
    await expect(
      service.extrairTexto(Buffer.from('x'), 'image/png'),
    ).rejects.toBeInstanceOf(UnsupportedMediaTypeException);
  });
});
