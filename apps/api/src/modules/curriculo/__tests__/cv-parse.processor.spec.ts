import type { Job, Queue } from 'bullmq';

import { ClaudeService } from '../../claude/claude.service.js';
import { CvParseProcessor } from '../processors/cv-parse.processor.js';
import { ParserService } from '../parsers/parser.service.js';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { StorageService } from '../../storage/storage.service.js';

function fakeJob(data: unknown, id = '1'): Job<unknown> {
  return { id, data, attemptsMade: 0 } as Job<unknown>;
}

describe('CvParseProcessor', () => {
  let storage: jest.Mocked<StorageService>;
  let parser: jest.Mocked<ParserService>;
  let claude: jest.Mocked<ClaudeService>;
  let prisma: any;
  let filaEmbedding: jest.Mocked<Queue>;
  let processor: CvParseProcessor;

  const candidaturaId = '00000000-0000-4000-8000-000000000001';
  const storageKey = 'curriculo/ab/cd/sha.pdf';

  beforeEach(() => {
    storage = {
      getObject: jest.fn(),
    } as unknown as jest.Mocked<StorageService>;

    parser = {
      extrairTexto: jest.fn(),
    } as unknown as jest.Mocked<ParserService>;

    claude = {
      estruturarCurriculo: jest.fn(),
    } as unknown as jest.Mocked<ClaudeService>;

    prisma = {
      curriculoProcessado: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };

    filaEmbedding = {
      add: jest.fn(),
    } as unknown as jest.Mocked<Queue>;

    processor = new CvParseProcessor(
      storage,
      parser,
      claude,
      prisma as PrismaService,
      filaEmbedding,
    );
  });

  it('rejeita payload inválido com erro determinístico', async () => {
    await expect(
      processor.process(fakeJob({ candidaturaId: 'not-uuid' })),
    ).rejects.toThrow(/Payload inválido/);
    expect(storage.getObject).not.toHaveBeenCalled();
  });

  it('se ainda não existe registro do download, lança erro recuperável', async () => {
    prisma.curriculoProcessado.findUnique.mockResolvedValue(null);
    await expect(
      processor.process(fakeJob({ candidaturaId, storageKey })),
    ).rejects.toThrow(/re-tentando/i);
  });

  it('fluxo completo: baixa, extrai, chama Claude, persiste, enfileira embedding', async () => {
    prisma.curriculoProcessado.findUnique.mockResolvedValue({
      id: 'cv-1',
      parser_versao: 'pending',
      arquivo_url: storageKey,
    });

    storage.getObject.mockResolvedValue({
      body: Buffer.from('binary'),
      contentType: 'application/pdf',
      size: 6,
    });

    parser.extrairTexto.mockResolvedValue({
      bruto: 'João Silva, dev backend.',
      normalizado: 'João Silva, dev backend.',
      parser: 'pdf',
    });

    claude.estruturarCurriculo.mockResolvedValue({
      estruturado: {
        resumo: 'Dev backend.',
        experiencias: [{ cargo: 'Dev', empresa: 'Unifique' }],
        formacoes: [],
        competencias: ['Node.js'],
        idiomas: [],
        certificacoes: [],
        anos_experiencia: 8,
      },
      parserVersao: 'claude-curriculo-v1',
      tokensEntrada: 1000,
      tokensSaida: 200,
    });

    prisma.curriculoProcessado.update.mockResolvedValue({});

    const out = await processor.process(
      fakeJob({ candidaturaId, storageKey }),
    );

    expect(out.candidaturaId).toBe(candidaturaId);
    expect(out.parserVersao).toBe('claude-curriculo-v1');

    expect(parser.extrairTexto).toHaveBeenCalledWith(
      expect.any(Buffer),
      'application/pdf',
    );
    expect(claude.estruturarCurriculo).toHaveBeenCalledWith(
      'João Silva, dev backend.',
    );

    expect(prisma.curriculoProcessado.update).toHaveBeenCalledWith({
      where: { candidatura_id: candidaturaId },
      data: expect.objectContaining({
        texto_bruto: 'João Silva, dev backend.',
        competencias: ['Node.js'],
        parser_versao: 'claude-curriculo-v1',
        anos_experiencia: 8,
      }),
    });

    expect(filaEmbedding.add).toHaveBeenCalledWith(
      'embedding-curriculo',
      { candidaturaId, alvo: 'curriculo' },
      { jobId: `emb-cv-${candidaturaId}` },
    );
  });
});
