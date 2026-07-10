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
      findMany: jest.fn().mockResolvedValue([]),
      aggregate: jest.fn().mockResolvedValue({ _max: { ordem: null } }),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    perguntaPadrao: {
      findMany: jest.fn().mockResolvedValue([]),
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

    // Perguntas geradas carregam origem IA
    const createArgs = prismaSingleton.perguntaEntrevista.create.mock.calls[0][0];
    expect(createArgs.data.origem).toBe('IA');
  });

  it('substituir=true apaga SOMENTE as perguntas de origem IA', async () => {
    prismaSingleton.candidatura.findUnique.mockResolvedValue({
      id: candidaturaId,
      vaga_id: 'v-1',
      vaga: { id: 'v-1', titulo: 'Dev', descricao: 'd', requisitos_json: null, requisitos_texto: null },
      curriculo: { resumo: null, competencias: [], experiencias: [], formacoes: [], idiomas: [], certificacoes: [], anos_experiencia: 3, parser_versao: 'claude-curriculo-v1' },
    });
    const perguntasMock = Array.from({ length: 6 }, (_, i) => ({
      pergunta: `Pergunta número ${i + 1} para validar competência específica.`,
      objetivo: 'Validar profundidade.',
      competencia: 'Node.js',
      dificuldade: 'media' as const,
    }));
    createMock.mockResolvedValue({
      stop_reason: 'tool_use',
      content: [
        { type: 'tool_use', name: 'gerar_perguntas', input: { perguntas: perguntasMock } },
      ],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    prismaSingleton.perguntaEntrevista.create.mockImplementation(
      async ({ data }: any) => ({ id: `p-${data.ordem}`, ...data }),
    );

    await service.gerar({ candidaturaId, substituir: true });

    expect(prismaSingleton.perguntaEntrevista.deleteMany).toHaveBeenCalledWith({
      where: { vaga_id: 'v-1', entrevista_id: null, origem: 'IA' },
    });
  });

  it('inclui as perguntas já cadastradas no prompt e ordena as geradas depois delas', async () => {
    prismaSingleton.candidatura.findUnique.mockResolvedValue({
      id: candidaturaId,
      vaga_id: 'v-1',
      vaga: { id: 'v-1', titulo: 'Dev', descricao: 'd', requisitos_json: null, requisitos_texto: null },
      curriculo: { resumo: null, competencias: [], experiencias: [], formacoes: [], idiomas: [], certificacoes: [], anos_experiencia: 3, parser_versao: 'claude-curriculo-v1' },
    });
    // Manuais existentes (origem HUMANO) + padrão do DHO
    prismaSingleton.perguntaEntrevista.findMany.mockResolvedValue([
      { pergunta: 'Pergunta manual cadastrada pelo DHO sobre cultura?', ordem: 2, entrevista_id: null },
    ]);
    prismaSingleton.perguntaPadrao.findMany.mockResolvedValue([
      { pergunta: 'O que você conhece da empresa e por que quer trabalhar aqui?' },
    ]);
    const perguntasMock = Array.from({ length: 6 }, (_, i) => ({
      pergunta: `Pergunta número ${i + 1} para validar competência específica.`,
      objetivo: 'Validar profundidade.',
      competencia: 'Node.js',
      dificuldade: 'media' as const,
    }));
    createMock.mockResolvedValue({
      stop_reason: 'tool_use',
      content: [
        { type: 'tool_use', name: 'gerar_perguntas', input: { perguntas: perguntasMock } },
      ],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    prismaSingleton.perguntaEntrevista.create.mockImplementation(
      async ({ data }: any) => ({ id: `p-${data.ordem}`, ...data }),
    );

    const out = await service.gerar({ candidaturaId });

    const llmArgs = createMock.mock.calls[0][0];
    const textoUser = llmArgs.messages[0].content[0].text as string;
    expect(textoUser).toContain('<perguntas_ja_cadastradas>');
    expect(textoUser).toContain('Pergunta manual cadastrada pelo DHO');
    expect(textoUser).toContain('O que você conhece da empresa');

    // Geradas entram DEPOIS da maior ordem manual (2) → começam em 3
    expect(out.perguntas[0].ordem).toBe(3);
  });

  it('rejeita saída do LLM sem nenhuma pergunta (Zod)', async () => {
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
          input: { perguntas: [] },
        },
      ],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    await expect(service.gerar({ candidaturaId })).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });

  it('aceita poucas perguntas quando o roteiro já está quase completo', async () => {
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
                pergunta: 'Só faltava investigar este requisito da vaga: como você lida com plantões?',
                objetivo: 'Cobrir a lacuna de disponibilidade',
                competencia: 'Disponibilidade',
                dificuldade: 'baixa',
              },
              {
                pergunta: 'Qual foi o maior sistema legado que você já manteve e o que mudaria nele?',
                objetivo: 'Cobrir requisito de manutenção de legado',
                competencia: 'Manutenção',
                dificuldade: 'media',
              },
            ],
          },
        },
      ],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    prismaSingleton.perguntaEntrevista.create.mockImplementation(
      async ({ data }: any) => ({ id: `p-${data.ordem}`, ...data }),
    );

    const out = await service.gerar({ candidaturaId });
    expect(out.perguntas).toHaveLength(2);
  });
});

describe('QuestionsService.criar (pergunta manual)', () => {
  let service: QuestionsService;
  const entrevistaId = '00000000-0000-4000-8000-0000000000aa';

  beforeEach(() => {
    prismaSingleton = buildPrisma();
    service = new QuestionsService(
      prismaSingleton as unknown as PrismaService,
      configMock(),
    );
  });

  it('rejeita pergunta muito curta', async () => {
    await expect(
      service.criar({ vagaId: 'v-1', pergunta: 'curta?' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejeita sem vagaId e sem entrevistaId', async () => {
    await expect(
      service.criar({ pergunta: 'Uma pergunta válida com mais de dez caracteres?' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejeita entrevista inexistente', async () => {
    prismaSingleton.entrevista.findUnique.mockResolvedValue(null);
    await expect(
      service.criar({
        entrevistaId,
        pergunta: 'Uma pergunta válida com mais de dez caracteres?',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('cria com origem HUMANO, resolve a vaga pela entrevista e ordena no fim', async () => {
    prismaSingleton.entrevista.findUnique.mockResolvedValue({
      id: entrevistaId,
      candidatura: { vaga_id: 'v-1' },
    });
    prismaSingleton.perguntaEntrevista.aggregate.mockResolvedValue({
      _max: { ordem: 7 },
    });
    prismaSingleton.perguntaEntrevista.create.mockImplementation(
      async ({ data }: any) => ({ id: 'p-nova', ...data }),
    );

    const out: any = await service.criar({
      entrevistaId,
      pergunta: '  Como você lida com feedbacks difíceis?  ',
      objetivo: 'Avaliar maturidade',
      criadoPor: 'Maria do DHO',
    });

    const createArgs = prismaSingleton.perguntaEntrevista.create.mock.calls[0][0];
    expect(createArgs.data.origem).toBe('HUMANO');
    expect(createArgs.data.vaga_id).toBe('v-1');
    expect(createArgs.data.entrevista_id).toBe(entrevistaId);
    expect(createArgs.data.ordem).toBe(8);
    expect(createArgs.data.pergunta).toBe('Como você lida com feedbacks difíceis?');
    expect(createArgs.data.criado_por).toBe('Maria do DHO');
    expect(out.id).toBe('p-nova');
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
