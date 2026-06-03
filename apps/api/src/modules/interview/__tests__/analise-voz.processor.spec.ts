import { ConfigService } from '@nestjs/config';
import type { Job } from 'bullmq';

const createMock = jest.fn();
jest.mock('@anthropic-ai/sdk', () => {
  const APIError = class extends Error {
    status?: number;
    constructor(msg: string, status?: number) {
      super(msg);
      this.status = status;
    }
  };
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      messages: { create: createMock },
    })),
    APIError,
  };
});

import { AnaliseVozProcessor } from '../processors/analise-voz.processor.js';
import { PrismaService } from '../../../prisma/prisma.service.js';

function fakeJob(data: unknown, id = '1'): Job<unknown> {
  return { id, data, attemptsMade: 0 } as Job<unknown>;
}

function configMock(): ConfigService {
  const map: Record<string, unknown> = {
    ANTHROPIC_API_KEY: 'sk-ant-test-1234567890',
    ANTHROPIC_MODEL: 'claude-sonnet-4-6',
    ANTHROPIC_MAX_TOKENS: 4096,
    ANTHROPIC_TIMEOUT_MS: 60_000,
    ANTHROPIC_RETRY_MAX: 3,
  };
  return {
    getOrThrow: <T>(k: string) => map[k] as T,
    get: <T>(k: string) => map[k] as T,
  } as unknown as ConfigService;
}

describe('AnaliseVozProcessor', () => {
  let prisma: any;
  let processor: AnaliseVozProcessor;
  const entrevistaId = '00000000-0000-4000-8000-000000000001';

  beforeEach(() => {
    createMock.mockReset();
    prisma = {
      transcricao: {
        findUnique: jest.fn(),
      },
      analiseVoz: {
        upsert: jest.fn().mockResolvedValue({}),
      },
    };
    processor = new AnaliseVozProcessor(
      prisma as PrismaService,
      configMock(),
    );
  });

  function transcricaoExemplo() {
    return {
      id: 'tr-1',
      idioma: 'pt-BR',
      texto_completo:
        'Entrevistador: olá. Candidato: ah, oi, tudo bem? Eh, sim, eu trabalhei na Unifique. Tipo, foi muito bom.',
      segmentos: {
        utterances: [
          {
            start: 0,
            end: 2000,
            speaker: 'A',
            text: 'Olá, prazer em conhecer.',
            confidence: 0.95,
          },
          {
            start: 2000,
            end: 12000,
            speaker: 'B',
            text: 'Ah, oi, tudo bem? Eh, eu trabalhei na Unifique por dois anos. Tipo, foi muito bom assim.',
            confidence: 0.88,
          },
          {
            start: 12000,
            end: 14000,
            speaker: 'A',
            text: 'Que legal.',
            confidence: 0.92,
          },
          {
            start: 14000,
            end: 20000,
            speaker: 'B',
            text: 'Sim, sabe, eu gostei muito do trabalho.',
            confidence: 0.85,
          },
        ],
        sentimentResults: [
          {
            text: 'Olá, prazer em conhecer.',
            start: 0,
            end: 2000,
            sentiment: 'POSITIVE',
            speaker: 'A',
          },
          {
            text: 'Ah, oi, tudo bem? Eh, eu trabalhei na Unifique.',
            start: 2000,
            end: 12000,
            sentiment: 'POSITIVE',
            speaker: 'B',
          },
          {
            text: 'Sim, sabe, eu gostei muito do trabalho.',
            start: 14000,
            end: 20000,
            sentiment: 'POSITIVE',
            speaker: 'B',
          },
        ],
      },
    };
  }

  it('rejeita payload inválido', async () => {
    await expect(
      processor.process(fakeJob({ entrevistaId: 'x' })),
    ).rejects.toThrow(/Payload inválido/);
  });

  it('lança erro se transcrição ainda não existe', async () => {
    prisma.transcricao.findUnique.mockResolvedValue(null);
    await expect(
      processor.process(fakeJob({ entrevistaId })),
    ).rejects.toThrow(/ainda não existe/);
  });

  it('identifica candidato pelo speaker com mais fala e conta hesitações', async () => {
    prisma.transcricao.findUnique.mockResolvedValue(transcricaoExemplo());
    createMock.mockResolvedValue({
      stop_reason: 'tool_use',
      content: [
        {
          type: 'tool_use',
          name: 'analisar_tom_de_voz',
          input: {
            confianca: 0.7,
            nervosismo: 0.4,
            entusiasmo: 0.6,
            observacoes:
              'Candidato demonstra postura amistosa, com algumas hesitações no início.',
            evidencias: [
              { trecho: 'Ah, oi, tudo bem?', aspecto: 'nervosismo' },
            ],
          },
        },
      ],
      usage: { input_tokens: 100, output_tokens: 80 },
    });

    const out = await processor.process(fakeJob({ entrevistaId }));

    expect(out.sentimentoGlobal).toBe('POSITIVO');
    expect(prisma.analiseVoz.upsert).toHaveBeenCalledTimes(1);
    const args = prisma.analiseVoz.upsert.mock.calls[0][0];
    // hesitacoes: "Ah", "Eh", "Tipo", "assim", "Sim", "sabe" — várias
    expect(args.create.hesitacao_count).toBeGreaterThanOrEqual(3);
    expect(args.create.sentimento_global).toBe('POSITIVO');
    expect(args.create.confianca_media).toBe(0.7);
    expect(args.create.observacoes_llm).toMatch(/postura amistosa/);
  });

  it('fallback determinístico quando LLM falha (não bloqueia o pipeline)', async () => {
    prisma.transcricao.findUnique.mockResolvedValue(transcricaoExemplo());
    const err: any = new Error('rate limit');
    err.status = 429;
    createMock.mockRejectedValue(err);

    const out = await processor.process(fakeJob({ entrevistaId }));

    expect(out.sentimentoGlobal).toBe('POSITIVO');
    expect(prisma.analiseVoz.upsert).toHaveBeenCalled();
    const args = prisma.analiseVoz.upsert.mock.calls[0][0];
    expect(args.create.observacoes_llm).toMatch(/Análise qualitativa indisponível/);
  });
});
