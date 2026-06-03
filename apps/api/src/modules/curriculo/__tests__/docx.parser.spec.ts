import { DocxParser } from '../parsers/docx.parser.js';

jest.mock('mammoth', () => ({
  __esModule: true,
  extractRawText: jest.fn(),
}));

import * as mammoth from 'mammoth';

describe('DocxParser', () => {
  let parser: DocxParser;
  // ZIP magic: PK\x03\x04 — assinatura usada por DOCX (OpenXML)
  const docxBuffer = Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.from('rest of the docx zip stream'),
  ]);

  beforeEach(() => {
    parser = new DocxParser();
    (mammoth.extractRawText as jest.Mock).mockReset();
  });

  it('rejeita buffer vazio', async () => {
    await expect(parser.extrair(Buffer.alloc(0))).rejects.toThrow(/vazio/);
  });

  it('rejeita .doc legado (sem assinatura ZIP)', async () => {
    // Magic CFB: D0 CF 11 E0 — não é ZIP.
    const docBuffer = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    await expect(parser.extrair(docBuffer)).rejects.toThrow(/legado|ZIP/i);
  });

  it('extrai texto via mammoth', async () => {
    (mammoth.extractRawText as jest.Mock).mockResolvedValue({
      value: 'João Silva\n\nEngenheiro de Software com experiência em Node.js.',
      messages: [],
    });
    const out = await parser.extrair(docxBuffer);
    expect(out.parser).toBe('docx');
    expect(out.normalizado).toContain('João Silva');
    expect(out.normalizado).toContain('Node.js');
  });

  it('falha quando mammoth retorna texto vazio', async () => {
    (mammoth.extractRawText as jest.Mock).mockResolvedValue({
      value: '',
      messages: [],
    });
    await expect(parser.extrair(docxBuffer)).rejects.toThrow(/vazio|ilegível/);
  });
});
