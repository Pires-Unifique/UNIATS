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
    constructor(message: string, status?: number) {
      super(message);
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

import { MatchingService } from '../services/matching.service.js';
import { PrismaService } from '../../../prisma/prisma.service.js';

function configMock(): ConfigService {
  const map: Record<string, unknown> = {
    ANTHROPIC_API_KEY: 'sk-ant-test-key-1234567890',
    ANTHROPIC_MODEL: 'claude-sonnet-4-6',
    ANTHROPIC_MAX_TOKENS: 4096,
    ANTHROPIC_TIMEOUT_MS: 60_000,
    ANTHROPIC_RETRY_MAX: 3,
    VOYAGE_MODEL: 'voyage-3',
    MATCHING_TOP_K: 20,
  };
  return {
    getOrThrow: <T>(k: string) => map[k] as T,
    get: <T>(k: string) => map[k] as T,
  } as unknown as ConfigService;
}

function buildPrismaMock() {
  return {
    candidatura: { findUnique: jest.fn() },
    vaga: { findUnique: jest.fn() },
    score: { deleteMany: jest.fn(), createMany: jest.fn() },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(async (ops) => {
      // ops é um array de PrismaPromise no nosso caso
      if (Array.isArray(ops)) {
        return Promise.all(ops);
      }
      return ops;
    }),
  };
}

describe('MatchingService.scorearCandidatura', () => {
  let prisma: ReturnType<typeof buildPrismaMock>;
  let service: MatchingService;
  const candidaturaId = '00000000-0000-4000-8000-000000000001';

  beforeEach(() => {
    createMock.mockReset();
    prisma = buildPrismaMock();
    service = new MatchingService(prisma as unknown as PrismaService, configMock());
  });

  it('exige candidatura existente com currículo estruturado', async () => {
    prisma.candidatura.findUnique.mockResolvedValue(null);
    await expect(service.scorearCandidatura(candidaturaId)).rejects.toBeInstanceOf(
      NotFoundException,
    );

    prisma.candidatura.findUnique.mockResolvedValue({
      id: candidaturaId,
      vaga_id: 'v',
      candidato_id: 'c',
      candidato: { nome_completo: 'Fulano' },
      curriculo: null,
    });
    await expect(service.scorearCandidatura(candidaturaId)).rejects.toBeInstanceOf(
      BadRequestException,
    );

    prisma.candidatura.findUnique.mockResolvedValue({
      id: candidaturaId,
      vaga_id: 'v',
      candidato_id: 'c',
      candidato: { nome_completo: 'Fulano' },
      curriculo: { parser_versao: 'pending', id: 'cv-1' },
    });
    await expect(service.scorearCandidatura(candidaturaId)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('fluxo completo: calcula similaridade, chama LLM, persiste 3 scores e retorna consolidado correto', async () => {
    const vagaId = '00000000-0000-4000-8000-0000000000aa';
    const curriculoId = '00000000-0000-4000-8000-0000000000bb';

    prisma.candidatura.findUnique.mockResolvedValue({
      id: candidaturaId,
      vaga_id: vagaId,
      candidato_id: 'cand-1',
      candidato: { nome_completo: 'Ana Pereira' },
      curriculo: {
        id: curriculoId,
        texto_normalizado: 'CV bruto',
        resumo: 'Dev backend',
        competencias: ['Node.js'],
        experiencias: [{ cargo: 'Dev', empresa: 'X' }],
        formacoes: [],
        idiomas: [],
        certificacoes: [],
        anos_experiencia: 5,
        parser_versao: 'claude-curriculo-v1',
      },
    });
    prisma.vaga.findUnique.mockResolvedValue({
      titulo: 'Dev Sr',
      descricao: 'descrição',
      requisitos_texto: 'req',
      requisitos_json: { mandatory: 'Node.js' },
    });

    // Distância cosseno = 0.2 → similaridade = (1 - 0.1) * 100 = 90
    prisma.$queryRaw.mockResolvedValue([{ distancia: 0.2 }]);

    createMock.mockResolvedValue({
      stop_reason: 'tool_use',
      content: [
        {
          type: 'tool_use',
          name: 'avaliar_aderencia',
          input: {
            score: 80,
            justificativa:
              'Candidata tem 5 anos em Node.js, atendendo o requisito obrigatório.',
            pontos_fortes: ['Node.js sólido'],
            lacunas: [],
            evidencias: [
              {
                eixo: 'competencias',
                trecho: 'Node.js',
                impacto: 'positivo',
              },
            ],
          },
        },
      ],
      usage: { input_tokens: 500, output_tokens: 200 },
    });

    prisma.score.deleteMany.mockResolvedValue({ count: 0 });
    prisma.score.createMany.mockResolvedValue({ count: 3 });

    const out = await service.scorearCandidatura(candidaturaId);

    // Score consolidado = 0.4 × 90 + 0.6 × 80 = 36 + 48 = 84
    expect(out.scoreConsolidado).toBeCloseTo(84, 1);
    expect(out.similaridadeVetorial).toBeCloseTo(90, 1);
    expect(out.scoreRankingCv).toBe(80);
    expect(out.candidatoNome).toBe('Ana Pereira');

    // Persistiu 3 linhas
    expect(prisma.score.createMany).toHaveBeenCalledTimes(1);
    const data = prisma.score.createMany.mock.calls[0][0].data;
    expect(data).toHaveLength(3);
    const tipos = data.map((d: any) => d.tipo).sort();
    expect(tipos).toEqual(['CONSOLIDADO', 'RANKING_CV', 'SIMILARIDADE_VETORIAL']);

    // Apagou anteriores antes de inserir (idempotência)
    expect(prisma.score.deleteMany).toHaveBeenCalledWith({
      where: {
        candidatura_id: candidaturaId,
        tipo: { in: ['SIMILARIDADE_VETORIAL', 'RANKING_CV', 'CONSOLIDADO'] },
      },
    });

    // Confere que o LLM foi chamado com tool_choice forçado
    const llmArgs = createMock.mock.calls[0][0];
    expect(llmArgs.tool_choice).toEqual({
      type: 'tool',
      name: 'avaliar_aderencia',
    });
  });

  it('rejeita quando embedding da vaga ou do CV não existe', async () => {
    prisma.candidatura.findUnique.mockResolvedValue({
      id: candidaturaId,
      vaga_id: 'v',
      candidato_id: 'c',
      candidato: { nome_completo: 'X' },
      curriculo: {
        id: 'cv',
        texto_normalizado: 'x',
        competencias: [],
        experiencias: [],
        formacoes: [],
        idiomas: [],
        certificacoes: [],
        anos_experiencia: null,
        parser_versao: 'v1',
      },
    });
    prisma.$queryRaw.mockResolvedValue([]);

    await expect(service.scorearCandidatura(candidaturaId)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  // Helper: mocks mínimos para chegar até o parse da avaliação do Claude.
  const prepararParaParse = (distancia = 1) => {
    prisma.candidatura.findUnique.mockResolvedValue({
      id: candidaturaId,
      vaga_id: 'v',
      candidato_id: 'c',
      candidato: { nome_completo: 'X' },
      curriculo: {
        id: 'cv',
        texto_normalizado: 'x',
        competencias: [],
        experiencias: [],
        formacoes: [],
        idiomas: [],
        certificacoes: [],
        anos_experiencia: null,
        parser_versao: 'v1',
      },
    });
    prisma.vaga.findUnique.mockResolvedValue({
      titulo: 'T',
      descricao: '',
      requisitos_texto: null,
      requisitos_json: null,
    });
    prisma.$queryRaw.mockResolvedValue([{ distancia }]);
    prisma.score.deleteMany.mockResolvedValue({ count: 0 });
    prisma.score.createMany.mockResolvedValue({ count: 3 });
  };

  it('tolera avaliação fora do padrão: clampa score >100 e aceita justificativa curta', async () => {
    prepararParaParse();
    createMock.mockResolvedValue({
      stop_reason: 'tool_use',
      content: [
        {
          type: 'tool_use',
          name: 'avaliar_aderencia',
          // Antes derrubava o candidato (score>100 + justificativa curta);
          // agora é coagido: score clampado p/ 100, justificativa aceita.
          input: { score: 150, justificativa: 'curta' },
        },
      ],
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    const out = await service.scorearCandidatura(candidaturaId);
    expect(out.scoreRankingCv).toBe(100); // 150 → clampado
  });

  it('descarta evidência inválida (enum errado) sem reprovar a avaliação inteira', async () => {
    prepararParaParse();
    createMock.mockResolvedValue({
      stop_reason: 'tool_use',
      content: [
        {
          type: 'tool_use',
          name: 'avaliar_aderencia',
          input: {
            score: 70,
            justificativa: 'Atende parcialmente os requisitos da vaga.',
            evidencias: [
              { eixo: 'eixo_inexistente', trecho: 'x', impacto: 'positivo' }, // descartada
              { eixo: 'competencias', trecho: 'ok', impacto: 'positivo' }, // mantida
            ],
          },
        },
      ],
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    const out = await service.scorearCandidatura(candidaturaId);
    expect(out.scoreRankingCv).toBe(70); // aceita apesar da evidência ruim
  });

  it('ainda rejeita quando o campo essencial (score) é irrecuperável', async () => {
    prepararParaParse();
    createMock.mockResolvedValue({
      stop_reason: 'tool_use',
      content: [
        {
          type: 'tool_use',
          name: 'avaliar_aderencia',
          input: { justificativa: 'sem score numérico', score: 'abc' }, // score não-numérico
        },
      ],
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    await expect(service.scorearCandidatura(candidaturaId)).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });
});
