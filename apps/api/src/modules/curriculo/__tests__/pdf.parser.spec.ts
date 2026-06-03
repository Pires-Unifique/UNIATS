import { PdfParser } from '../parsers/pdf.parser.js';

/**
 * Os testes do PdfParser mockam o módulo `pdf-parse` em vez de fornecer
 * um PDF real — queremos validar: validação de magic bytes, normalização,
 * detecção de PDF escaneado.
 */
jest.mock('pdf-parse', () => ({
  __esModule: true,
  default: jest.fn(),
}));

import pdfParse from 'pdf-parse';

describe('PdfParser', () => {
  let parser: PdfParser;
  const pdfBuffer = Buffer.concat([
    Buffer.from('%PDF', 'ascii'),
    Buffer.from('-1.7 dummy content'),
  ]);

  beforeEach(() => {
    parser = new PdfParser();
    (pdfParse as unknown as jest.Mock).mockReset();
  });

  it('rejeita buffer vazio', async () => {
    await expect(parser.extrair(Buffer.alloc(0))).rejects.toThrow(/vazio/);
  });

  it('rejeita arquivos sem magic bytes %PDF', async () => {
    await expect(parser.extrair(Buffer.from('NOTPDF'))).rejects.toThrow(
      /magic bytes/i,
    );
  });

  it('extrai texto e normaliza', async () => {
    (pdfParse as unknown as jest.Mock).mockResolvedValue({
      text: 'João Silva  trabalha   com\n\nbackend há 8 anos no Banco X.',
      numpages: 1,
    });
    const out = await parser.extrair(pdfBuffer);
    expect(out.parser).toBe('pdf');
    expect(out.normalizado).toBe(
      'João Silva trabalha com\nbackend há 8 anos no Banco X.',
    );
    expect(out.paginas).toBe(1);
  });

  it('detecta PDF escaneado (texto inutilizável)', async () => {
    (pdfParse as unknown as jest.Mock).mockResolvedValue({
      text: '\u0000'.repeat(500),
      numpages: 3,
    });
    await expect(parser.extrair(pdfBuffer)).rejects.toThrow(/escaneada|OCR/);
  });
});
