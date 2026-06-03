import { ConfigService } from '@nestjs/config';
import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';

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

import { QuestionsService } from '../questions.service.js';
import { PrismaService } from '../../../prisma/prisma.service.js';

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

function buildPrisma() {
  return {
    candidatura: { findUnique: jest.fn() },
    entrevista: { findUnique: jest.fn() },
    perguntaEntrevista: {
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    $transaction: jest.fn(async (cb: any) => cb(prismaSingleton)),
  };
}

let prismaSingleton: any;

describe('QuestionsService.gerar', () => {
  let service: QuestionsService;
  const candidaturaId = '00000000-0000-4000-8000-000000000001';

  beforeEach(() => {
    createMock.mockReset();
    prismaSingleton = buildPrisma();
    service = new QuestionsService(
      prismaSingleton as unknown as PrismaService,
      configMock(),
    );
  });

  it('rejeita candidatura inexistente', async () => {
    prismaSingleton.candidatura.findUnique.mockResolvedValue(null);
    await expect(service.gerar({ candidaturaId })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejeita candidatura sem currículo', async () => {
    prismaSingleton.candidatura.findUnique.mockResolvedValue({
      id: candidaturaId,
      vaga_id: 'v-1',
      vaga: { id: 'v-1', titulo: 'Dev', descricao: null, requisitos_json: null, requisitos_texto: null },
      curriculo: null,
    });
    await expect(service.gerar({ candidaturaId })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejeita currículo ainda não estruturado (parser_versao=pending)', async () => {
    prismaSingleton.candidatura.findUnique.mockResolvedValue({
      id: candidaturaId,
      vaga_id: 'v-1',
      vaga: { id: 'v-1', titulo: 'Dev', descricao: null, requisitos_json: null, requisitos_texto: null },
      curriculo: {
        competencias: [],
        experiencias: [],
        formacoes: [],
        idiomas: [],
        certificacoes: [],
        anos_experiencia: null,
        parser_versao: 'pending',
      },
    });
    await expect(service.gerar({ candidaturaId })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejeita quando entrevistaId não pertence à candidatura', async () => {
    prismaSingleton.candidatura.findUnique.mockResolvedValue({
      id: candidaturaId,
      vaga_id: 'v-1',
      vaga: { id: 'v-1', titulo: 'Dev', descricao: 'd', requisitos_json: null, requisitos_texto: null },
      curriculo: { competencias: [], experiencias: [], formacoes: [], idiomas: [], certificacoes: [], anos_experiencia: 5, parser_versao: 'claude-curriculo-v1' },
    });
    prismaSingleton.entrevista.findUnique.mockResolvedValue({
      id: 'e-1',
      candidatura_id: 'OUTRA-CANDIDATURA',
    });
    await expect(
      service.gerar({
        candidaturaId,
        entrevistaId: '00000000-0000-4000-8000-0000000000aa',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('fluxo completo: chama Claude com tool forçada, persiste perguntas em transação ordenadas', async () => {
    prismaSingleton.candidatura.findUnique.mockResolvedValue({
      id: candidaturaId,
      vaga_id: 'v-1',
      vaga: {
        id: 'v-1',
        titulo: 'Engenheiro Sr',
        descricao: 'Backend',
        requisitos_json: { mandatory: 'Node.js' },
        requisitos_texto: null,
      },
      curriculo: {
        resumo: 'Dev backend',
        competencias: ['Node.js'],
        experiencias: [],
        formacoes: [],
        idiomas: [],
        certificacoes: [],
        anos_experiencia: 6,
        parser_versao: 'claude-curriculo-v1',
      },
    });

    const perguntasMock = Array.from({ length: 7 }, (_, i) => ({
      pergunta: `Pergunta número ${i + 1} para validar competência específica.`,
      objetivo: 'Validar profundidade.',
      competencia: 'Node.js',
      dificuldade: (i < 2 ? 'baixa' : i < 5 ? 'media' : 'alta') as
        | 'baixa'
        | 'media'
        | 'alta',
      resposta_esperada: 'Sinais técnicos esperados.',
    }));

    createMock.mockResolvedValue({
      stop_reason: 'tool_use',
      content: [
        {
          type: 'tool_use',
          name: 'gerar_perguntas',
          input: { perguntas: perguntasMock },
        },
      ],
      usage: { input_tokens: 500, output_tokens: 800 },
    });

    prismaSingleton.perguntaEntrevista.create.mockImplementation(
      async ({ data }: any) => ({
        id: `p-${data.ordem}`,
        ordem: data.ordem,
        pergunta: data.pergunta,
        objetivo: data.objetivo,
        competencia: data.competencia,
        dificuldade: data.dificuldade,
        resposta_esperada: data.resposta_esperada,
      }),
    );

    const out = await service.gerar({ candidaturaId });

    expect(out.perguntas).toHaveLength(7);
    expect(out.promptVersao).toMatch(/^perguntas-v\d+$/);

    // Chamou tool_choice forçada para "gerar_perguntas"
    const llmArgs = createMock.mock.calls[0][0];
    expect(llmArgs.tool_choice).toEqual({
      type: 'tool',
      name: 'gerar_perguntas',
    });

    // Ordens 1..7
    expect(out.perguntas.map((p: any) => p.ordem)).toEqual([
      1, 2, 3, 4, 5, 6, 7,
    ]);

    // Não deletou nada (substituir=false por padrão)
    expect(prismaSingleton.perguntaEntrevista.deleteMany).not.toHaveBeenCalled();
  });

  it('rejeita saída do LLM com menos de 6 perguntas (Zod)', async () => {
    prismaSingleton.candidatura.findUnique.mockResolvedValue({
      id: candidaturaId,
      vaga_id: 'v-1',
      vaga: { id: 'v-1', titulo: 'X', descricao: null, requisitos_json: null, requisitos_texto: null },
      curriculo: { competencias: [], experiencias: [], formacoes: [], idiomas: [], certificacoes: [], anos_experiencia: 1, parser_versao: 'claude-curriculo-v1' },
    });
    createMock.mockResolvedValue({
      stop_reason: 'tool_use',
      content: [
        {
          type: 'tool_use',
          name: 'gerar_perguntas',
          input: {
            perguntas: [
              {
                pergunta: 'pergunta única muito curtinha aqui ok longa o suficiente',
                objetivo: 'algo',
                competencia: 'x',
                dificuldade: 'baixa',
              },
            ],
          },
        },
      ],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    await expect(service.gerar({ candidaturaId })).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });
});

describe('QuestionsService.atualizar/deletar', () => {
  let service: QuestionsService;

  beforeEach(() => {
    prismaSingleton = buildPrisma();
    service = new QuestionsService(
      prismaSingleton as unknown as PrismaService,
      configMock(),
    );
  });

  it('rejeita patch vazio', async () => {
    await expect(service.atualizar('p-1', {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejeita ordem inválida', async () => {
    await expect(
      service.atualizar('p-1', { ordem: 999 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('mapeia P2025 para NotFound', async () => {
    const err: any = new Error('not found');
    err.code = 'P2025';
    prismaSingleton.perguntaEntrevista.update.mockRejectedValue(err);
    await expect(
      service.atualizar('p-1', { pergunta: 'novo texto' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('deletar lança NotFound em P2025', async () => {
    const err: any = new Error();
    err.code = 'P2025';
    prismaSingleton.perguntaEntrevista.delete.mockRejectedValue(err);
    await expect(service.deletar('p-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
